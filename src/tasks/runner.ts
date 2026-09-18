/**
 * 定时任务的运行器。
 *
 * 两个设计要点：
 * 1. **同一时间只跑一个，撞上了排队而不是跳过**。两个任务定在同一分钟很常见，
 *    直接丢掉一次的话，用户看不出来少跑了。
 * 2. **每次运行开一个独立的托管窗口**，把 windowId 钉给智能体，
 *    它只在这个窗口里开标签页，不会去抢用户正在用的窗口；跑完自动关。
 */
import { runAgent, dropAgent, type AgentEvent } from "@/agent/runner";
import {
  addRun,
  patchRun,
  patchTask,
  getTask,
  idleStatus,
  computeNextRunAt,
} from "./store";
import type { RunStep, TaskRun } from "./types";

interface QueueItem {
  taskId: string;
  trigger: TaskRun["trigger"];
  runId: string;
}

const queue: QueueItem[] = [];
let active: { runId: string; taskId: string; controller: AbortController; windowId?: number } | null = null;
let pumping = false;

function notifyChanged() {
  chrome.runtime.sendMessage({ type: "tasks:changed" }).catch(() => {});
}

export function getRuntimeState() {
  return { activeRunId: active?.runId ?? null, queued: queue.length };
}

/** 排一次运行。返回这次运行的 id。 */
export async function enqueueRun(taskId: string, trigger: TaskRun["trigger"]): Promise<string> {
  const task = await getTask(taskId);
  if (!task) throw new Error("没找到这个任务");

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const run: TaskRun = {
    id: runId,
    taskId,
    trigger,
    status: "queued",
    startedAt: Date.now(),
    finishedAt: null,
    steps: [],
    summary: null,
    output: null,
    error: null,
  };
  await addRun(run);
  queue.push({ taskId, trigger, runId });
  notifyChanged();
  void pump();
  return runId;
}

/** 停掉正在跑的那次（如果是指定任务的话） */
export function stopRun(taskId: string): boolean {
  if (active?.taskId === taskId) {
    active.controller.abort();
    return true;
  }
  // 还在队列里就直接移除
  const idx = queue.findIndex((q) => q.taskId === taskId);
  if (idx >= 0) {
    const [item] = queue.splice(idx, 1);
    void patchRun(item.taskId, item.runId, { status: "stopped", finishedAt: Date.now() }).then(notifyChanged);
    return true;
  }
  return false;
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length > 0 && !active) {
      const item = queue.shift()!;
      await execute(item);
    }
  } finally {
    pumping = false;
  }
}

async function execute(item: QueueItem): Promise<void> {
  const { taskId, runId } = item;
  const task = await getTask(taskId);
  if (!task) {
    await patchRun(taskId, runId, { status: "failed", finishedAt: Date.now(), error: "任务已被删除" });
    notifyChanged();
    return;
  }

  const controller = new AbortController();
  active = { runId, taskId, controller };
  await patchTask(taskId, { status: "running" });
  await patchRun(taskId, runId, { status: "running", startedAt: Date.now() });
  notifyChanged();

  const steps: RunStep[] = [];
  let output = "";
  let failure: string | null = null;
  let stepFlushTimer: ReturnType<typeof setTimeout> | null = null;

  // 步骤攒一下再写，别每来一个事件就写一次存储
  const flushSteps = async () => {
    stepFlushTimer = null;
    await patchRun(taskId, runId, { steps: [...steps] });
    notifyChanged();
  };
  const scheduleFlush = () => {
    if (stepFlushTimer) return;
    stepFlushTimer = setTimeout(() => void flushSteps(), 800);
  };

  let windowId: number | undefined;
  const onWindowRemoved = (closedId: number) => {
    if (windowId !== undefined && closedId === windowId) {
      failure = "任务托管窗口被关掉了";
      controller.abort();
    }
  };

  try {
    // 托管窗口：不聚焦，免得抢用户的焦点
    const win = await chrome.windows.create({ url: "about:blank", focused: false, width: 1280, height: 860 });
    if (!win?.id) throw new Error("开不了托管窗口");
    windowId = win.id;
    active.windowId = windowId;
    chrome.windows.onRemoved.addListener(onWindowRemoved);

    const onEvent = (event: AgentEvent) => {
      switch (event.kind) {
        case "text":
          output = event.text;
          break;
        case "tool":
          steps.push({ at: Date.now(), kind: "tool", name: event.name, status: event.status });
          scheduleFlush();
          break;
        case "error":
          failure = failure ?? event.error;
          steps.push({ at: Date.now(), kind: "error", text: event.error });
          scheduleFlush();
          break;
        default:
          break;
      }
    };

    await runAgent({
      sessionId: `task_${runId}`,
      text: task.prompt,
      // 把窗口钉死，智能体只在这个窗口里开标签页
      extra: { windowId },
      signal: controller.signal,
      onEvent,
    });
  } catch (err) {
    failure = failure ?? (err instanceof Error ? err.message : String(err));
  } finally {
    chrome.windows.onRemoved.removeListener(onWindowRemoved);
    if (stepFlushTimer) clearTimeout(stepFlushTimer);
    if (windowId !== undefined) await chrome.windows.remove(windowId).catch(() => {});
    dropAgent(`task_${runId}`);

    if (output) steps.push({ at: Date.now(), kind: "text", text: output });

    const aborted = controller.signal.aborted;
    const status: TaskRun["status"] = failure ? "failed" : aborted ? "stopped" : "success";
    await patchRun(taskId, runId, {
      status,
      finishedAt: Date.now(),
      steps,
      output: output || null,
      summary: oneLine(output || failure || "", 180) || null,
      error: failure,
    });

    const fresh = await getTask(taskId);
    if (fresh) {
      await patchTask(taskId, {
        status: idleStatus(fresh.enabled, fresh.scheduleType),
        lastRunAt: Date.now(),
        nextRunAt: fresh.enabled ? computeNextRunAt(fresh.scheduleType, fresh.dailyTime) : null,
      });
    }
    active = null;
    notifyChanged();
  }
}

function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
