/**
 * 领活 → 干活 → 回报。
 *
 * 三条规矩，都来自服务端的租约设计：
 *
 * 1. **leaseId 是命根子**。上报开始、续租、回报都要带，对不上一律被拒。
 * 2. **拿到租约类错误（20401/20402/20403）就把活丢掉，绝不重试**。
 *    这时候活多半已经被服务端收回、派给别的机器了，重试只会把别人干的事搞乱。
 * 3. **没活可领不是错误**。claim 返回 null 就安静退出，不要当异常、不要退避。
 *
 * 同一时间只干一个活：并发干活没有意义（浏览器就一个），还会让续租逻辑变复杂。
 */
import {
  DeviceApiError,
  claimTask,
  isIdentityLost,
  isLeaseLost,
  renewTask,
  reportTask,
  revokedPatch,
  startTask,
} from "./api";
import { notifyDeviceChanged } from "./events";
import { runJob, summarize } from "./jobs";
import { addJob, loadDevice, patchDevice, patchJob } from "./store";
import { toJobDetail } from "./job-detail";
import type { ClaimedTask, JobRecord } from "./types";

/** 一次唤醒最多连着干几个活，免得队列很长时一直占着 Service Worker */
const MAX_JOBS_PER_PUMP = 5;
/** 续租失败（网络抖动）后隔多久再试 */
const RENEW_RETRY_MS = 30_000;

let busy = false;

export function isBusy(): boolean {
  return busy;
}

/**
 * 续租循环：在租约剩一半时续一次，续到活干完为止。
 * 不等到快过期才续——网络抖一下就来不及了。
 */
function startRenewLoop(task: ClaimedTask): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (expiresAt: number) => {
    if (cancelled) return;
    const delay = Math.max(5_000, Math.floor((expiresAt - Date.now()) / 2));
    timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        schedule(await renewTask(task.id, task.leaseId));
      } catch (err) {
        // 租约已经不是我们的了：不用再续，等干完那一步回报时会拿到同样的错误并丢掉
        if (err instanceof DeviceApiError && isLeaseLost(err.code)) return;
        schedule(Date.now() + RENEW_RETRY_MS * 2);
      }
    }, delay);
  };

  schedule(task.leaseExpiresAt);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

async function finishJob(taskId: string, patch: Partial<JobRecord>): Promise<void> {
  await patchJob(taskId, { finishedAt: Date.now(), ...patch });
  notifyDeviceChanged();
}

/**
 * 干一个活。
 * 返回 false 表示设备身份没了（令牌失效或被吊销），外层要停掉整轮。
 */
async function runOne(task: ClaimedTask): Promise<boolean> {
  const record: JobRecord = {
    taskId: task.id,
    type: task.type,
    startedAt: Date.now(),
    finishedAt: null,
    outcome: "running",
    summary: null,
    error: null,
    // 载荷在这里就存下来：后面任何一条失败分支都能显示「当时派下来的是什么」，
    // 而排查失败恰恰最需要这个
    payload: toJobDetail(task.payload),
    reported: null,
  };
  await addJob(record);
  notifyDeviceChanged();

  const stopRenew = startRenewLoop(task);
  /** 出错时用来判断该不该回报：还没开始干就失败的，留给租约过期自然回收 */
  let stage: "start" | "work" | "report" = "start";

  try {
    await startTask(task.id, task.leaseId);

    stage = "work";
    const result = await runJob(task);

    stage = "report";
    await reportTask(task.id, { leaseId: task.leaseId, success: true, result });

    await finishJob(task.id, {
      outcome: "success",
      summary: summarize(result),
      reported: toJobDetail(result),
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof DeviceApiError && isIdentityLost(err.code)) {
      await patchDevice(revokedPatch(err));
      await finishJob(task.id, { outcome: "dropped", error: message });
      return false;
    }

    if (err instanceof DeviceApiError && isLeaseLost(err.code)) {
      await finishJob(task.id, {
        outcome: "dropped",
        error: `${message}（这个活已经不归我们了，直接丢掉，没有重试）`,
      });
      return true;
    }

    if (stage === "report") {
      // 活干完了，结果没送出去。租约到期后服务端会重派，不在这里硬重试
      await finishJob(task.id, {
        outcome: "failed",
        error: `活干完了，但结果没送到服务端：${message}`,
      });
      return true;
    }

    if (stage === "start") {
      // 还没真开始干，回报失败没意义（多半也是网络问题），交给租约过期回收
      await finishJob(task.id, { outcome: "failed", error: `没能上报开始：${message}` });
      return true;
    }

    // 干活本身失败：如实回报，服务端按重试次数决定重排还是判失败
    const reported = await reportFailure(task, message);
    await finishJob(task.id, {
      outcome: reported === "dropped" ? "dropped" : "failed",
      reported: reported === "reported" ? toJobDetail({ success: false, error: message }) : null,
      error:
        reported === "reported"
          ? message
          : reported === "dropped"
            ? `${message}（回报时发现活已不归我们，丢掉）`
            : `${message}（失败原因没能送到服务端）`,
    });
    return true;
  } finally {
    stopRenew();
  }
}

async function reportFailure(
  task: ClaimedTask,
  message: string,
): Promise<"reported" | "dropped" | "unreported"> {
  try {
    await reportTask(task.id, { leaseId: task.leaseId, success: false, error: message });
    return "reported";
  } catch (err) {
    if (err instanceof DeviceApiError && isLeaseLost(err.code)) return "dropped";
    return "unreported";
  }
}

/**
 * 去领一轮活。定时闹钟、手动按钮、以后的 WebSocket 催办都调这个。
 * 返回干了几个活；0 表示没活可领（正常情况）。
 */
export async function pump(): Promise<number> {
  if (busy) return 0;

  const device = await loadDevice();
  if (!device.token || device.revoked) return 0;

  busy = true;
  notifyDeviceChanged();
  let worked = 0;

  try {
    for (let i = 0; i < MAX_JOBS_PER_PUMP; i++) {
      let task: ClaimedTask | null;
      try {
        task = await claimTask();
        await patchDevice({ lastClaimAt: Date.now(), lastClaimError: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const patch =
          err instanceof DeviceApiError && isIdentityLost(err.code) ? revokedPatch(err) : {};
        await patchDevice({ ...patch, lastClaimAt: Date.now(), lastClaimError: message });
        break;
      }

      if (!task) break; // 没活可领，正常退出
      worked += 1;
      if (!(await runOne(task))) break; // 身份没了，别再领了
    }
  } finally {
    busy = false;
    notifyDeviceChanged();
  }

  return worked;
}
