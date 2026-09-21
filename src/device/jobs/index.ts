/**
 * 各类工单怎么干。
 *
 * 一个类型一个处理函数，返回的东西就是回报给服务端的 result，格式要跟服务端的校验对上，
 * 对不上会被判成结果不合法。不认识的类型直接抛错，由上层如实回报失败——
 * 不要假装干成了，服务端那边会当成真做完了。
 *
 * **没实现的类型就是不注册。** 不要放一个「返回空结果」的占位处理函数：
 * 那样服务端会收到成功回报，工单转 succeeded，问题要到看数据时才发现。
 * 现在 `publish` 和 `claim_link` 就是这种情况——服务端载荷格式已经定了，
 * 但各平台具体怎么点还没定，所以这里一个都不注册，领到了会明确回报「不会干」。
 */
import type { ClaimedTask } from "../types";
import { runSyncCreatorNotes } from "./sync-creator-notes";

export type JobHandler = (task: ClaimedTask) => Promise<Record<string, unknown>>;

/**
 * echo：把 payload 里的 message 原样送回去，外加设备上的时间。
 * 这是打通链路用的，不碰浏览器、不依赖任何平台登录。
 */
const echo: JobHandler = async (task) => {
  const message = task.payload?.message;
  if (typeof message !== "string") {
    throw new Error("echo 工单的载荷里没有 message");
  }
  return { message, deviceTime: new Date().toISOString() };
};

const handlers: Record<string, JobHandler> = {
  echo,
  sync_creator_notes: runSyncCreatorNotes,
};

export function supportedTypes(): string[] {
  return Object.keys(handlers);
}

export async function runJob(task: ClaimedTask): Promise<Record<string, unknown>> {
  const handler = handlers[task.type];
  if (!handler) {
    throw new Error(`这个插件还不会干「${task.type}」类型的活，先更新插件或者改派别的设备`);
  }
  return handler(task);
}

/** 结果压成一行放进本地记录，给人看的 */
export function summarize(value: unknown, max = 160): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
