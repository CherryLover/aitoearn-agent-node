/**
 * 侧边栏 <-> 后台 的消息约定。
 *
 * 所有消息类型集中在这里定义，加一个就要在这里登记，
 * 免得散落到各处之后没人说得清后台到底收哪些消息。
 */
import type { ServerConfig } from "./config";
import type { ChatModel } from "@/agent/models";
import type { TaskInput, TaskSnapshot } from "@/tasks/types";
import type { DeviceSnapshot, PairInput } from "@/device/types";
import type { SetupStatus } from "./setup";

export type BackgroundRequest =
  | { type: "ping" }
  | { type: "getServerConfig" }
  | { type: "setServerConfig"; payload: Partial<ServerConfig> }
  | { type: "checkSetup" }
  | { type: "getAuth" }
  | { type: "setToken"; payload: { token: string } }
  | { type: "syncAuthFromWeb" }
  | { type: "clearAuth" }
  | { type: "listModels" }
  | { type: "selectModel"; payload: { name: string } }
  | { type: "chat:send"; payload: { conversationId: string; text: string } }
  | { type: "chat:stop"; payload: { conversationId: string } }
  | { type: "tasks:snapshot" }
  | { type: "tasks:create"; payload: TaskInput }
  | { type: "tasks:update"; payload: { id: string } & TaskInput }
  | { type: "tasks:delete"; payload: { id: string } }
  | { type: "tasks:setEnabled"; payload: { id: string; enabled: boolean } }
  | { type: "tasks:runNow"; payload: { id: string } }
  | { type: "tasks:stop"; payload: { id: string } }
  | { type: "tasks:clearRuns"; payload: { id: string } }
  | { type: "tasks:alarms" }
  | { type: "device:snapshot" }
  | { type: "device:pair"; payload: PairInput }
  | { type: "device:unpair" }
  | { type: "device:heartbeat" }
  | { type: "device:claim" }
  | { type: "device:clearJobs" }
  | { type: "device:setCapabilities"; payload: { capabilities: string[] } }
  | { type: "device:detectCapabilities" }
  | { type: "device:dryRunCollect"; payload: Record<string, unknown> };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** 后台主动推给侧边栏的事件（智能体的流式输出走这条） */
export type BackgroundEvent =
  | { type: "chat:text"; conversationId: string; text: string }
  | { type: "chat:thinking"; conversationId: string; text: string }
  | {
      type: "chat:tool";
      conversationId: string;
      toolCallId: string;
      name: string;
      status: "running" | "done" | "error";
      detail?: string;
    }
  | { type: "chat:done"; conversationId: string }
  | { type: "chat:error"; conversationId: string; error: string }
  | { type: "tasks:changed" }
  | { type: "device:changed" };

export type { TaskSnapshot, SetupStatus, DeviceSnapshot };

export interface ModelsPayload {
  models: ChatModel[];
  selected: string | null;
}

export async function sendToBackground<T = unknown>(request: BackgroundRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(request)) as BackgroundResponse<T> | undefined;
  if (!res) throw new Error("插件后台没有返回响应，请在扩展管理页重新加载插件后重试");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
