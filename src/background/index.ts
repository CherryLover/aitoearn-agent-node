/**
 * Service Worker 入口。
 *
 * 两条规矩：
 * - 所有需要「浏览器休眠也能醒」的监听器（alarms / onMessage）都在顶层同步注册，
 *   不等任何异步初始化。
 * - 消息路由用一张表登记，不写成一个大 switch。
 */
import type { BackgroundRequest, BackgroundResponse, ModelsPayload } from "@/shared/messages";
import { loadServerConfig, saveServerConfig } from "@/shared/config";
import { loadAuth, saveAuth, clearAuth, syncAuthFromWeb } from "@/shared/auth";
import { checkSetup } from "@/shared/setup";
import { fetchChatModels, setSelectedModel, SELECTED_MODEL_KEY } from "@/agent/models";
import { sendChat, stopChat } from "@/agent/chat";
import {
  loadTasks,
  loadRuns,
  createTask,
  updateTask,
  deleteTask,
  setTaskEnabled,
  clearRuns,
  markInterruptedRuns,
} from "@/tasks/store";
import { enqueueRun, stopRun, getRuntimeState } from "@/tasks/runner";
import { handleTaskAlarm, syncTaskAlarm, rebuildAllAlarms, listTaskAlarms } from "@/tasks/scheduler";
import type { TaskSnapshot } from "@/tasks/types";
import {
  bootstrapDevice,
  clearJobHistory,
  handleDeviceAlarm,
  heartbeatNow,
  pair,
  pump,
  snapshot as deviceSnapshot,
  unpair,
} from "@/device";

type Handler = (payload: any) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  ping: async () => ({ pong: true, at: Date.now() }),

  getServerConfig: async () => loadServerConfig(),
  setServerConfig: async (payload) => saveServerConfig(payload ?? {}),

  checkSetup: async () => checkSetup(),

  getAuth: async () => loadAuth(),
  setToken: async (payload) => {
    const token = String(payload?.token ?? "").trim();
    if (!token) throw new Error("凭证不能为空");
    return saveAuth({ token, source: "manual", userName: null });
  },
  syncAuthFromWeb: async () => {
    const { homeUrl } = await loadServerConfig();
    return syncAuthFromWeb(homeUrl);
  },
  clearAuth: async () => clearAuth(),

  listModels: async (): Promise<ModelsPayload> => {
    const models = await fetchChatModels();
    const stored = await chrome.storage.local.get(SELECTED_MODEL_KEY);
    const wanted = stored[SELECTED_MODEL_KEY] as string | undefined;
    const selected = models.find((m) => m.name === wanted)?.name ?? models[0]?.name ?? null;
    return { models, selected };
  },
  selectModel: async (payload) => {
    await setSelectedModel(String(payload?.name ?? ""));
    return { ok: true };
  },

  "chat:send": async (payload) => {
    await sendChat(payload.conversationId, payload.text);
    return { started: true };
  },
  "chat:stop": async (payload) => {
    stopChat(payload.conversationId);
    return { stopped: true };
  },

  "tasks:snapshot": async (): Promise<TaskSnapshot> => {
    const [tasks, runs] = await Promise.all([loadTasks(), loadRuns()]);
    return { tasks, runs, ...getRuntimeState() };
  },
  "tasks:create": async (payload) => {
    const task = await createTask(payload);
    await syncTaskAlarm(task.id);
    return task;
  },
  "tasks:update": async (payload) => {
    const { id, ...input } = payload;
    const task = await updateTask(id, input);
    await syncTaskAlarm(id);
    return task;
  },
  "tasks:delete": async (payload) => {
    await deleteTask(payload.id);
    await syncTaskAlarm(payload.id);
    return { ok: true };
  },
  "tasks:setEnabled": async (payload) => {
    const task = await setTaskEnabled(payload.id, payload.enabled);
    await syncTaskAlarm(payload.id);
    return task;
  },
  "tasks:runNow": async (payload) => ({ runId: await enqueueRun(payload.id, "manual") }),
  "tasks:stop": async (payload) => ({ stopped: stopRun(payload.id) }),
  "tasks:clearRuns": async (payload) => {
    await clearRuns(payload.id);
    return { ok: true };
  },
  // 调试用：看现在挂着哪些闹钟、什么时候响
  "tasks:alarms": async () => listTaskAlarms(),

  "device:snapshot": async () => deviceSnapshot(),
  // 配对结果里有令牌明文，不往界面送；界面自己再拉一份快照
  "device:pair": async (payload) => {
    await pair(payload);
    return { ok: true };
  },
  "device:unpair": async () => {
    await unpair();
    return { ok: true };
  },
  "device:heartbeat": async () => {
    await heartbeatNow();
    return { ok: true };
  },
  "device:claim": async () => ({ worked: await pump() }),
  "device:clearJobs": async () => {
    await clearJobHistory();
    return { ok: true };
  },
};

/** 后台自己广播出去的事件，回到这里时不要当成未知请求报错 */
function isBroadcast(type: unknown): boolean {
  if (typeof type !== "string") return false;
  return type.startsWith("chat:") || type === "tasks:changed" || type === "device:changed";
}

// ---- 顶层同步注册，下面不要放 await ----

chrome.runtime.onMessage.addListener((request: BackgroundRequest, _sender, sendResponse) => {
  const handler = handlers[request?.type];
  if (!handler) {
    if (isBroadcast(request?.type) && !("payload" in request)) {
      return false;
    }
    sendResponse({ ok: false, error: `未知的消息类型: ${request?.type}` } satisfies BackgroundResponse);
    return false;
  }
  Promise.resolve(handler((request as any).payload))
    .then((data) => sendResponse({ ok: true, data } satisfies BackgroundResponse))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies BackgroundResponse),
    );
  // 返回 true 表示会异步回包
  return true;
});

// 点插件图标打开侧边栏
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  /* 某些 Chrome 版本上不支持，忽略 */
});

// 闹钟监听器一定要在顶层同步注册：浏览器休眠后被闹钟唤醒时，
// Chrome 可能在任何 await 之前就派发事件，晚注册就会漏掉这一次触发。
chrome.alarms.onAlarm.addListener(handleTaskAlarm);
chrome.alarms.onAlarm.addListener(handleDeviceAlarm);

chrome.runtime.onInstalled.addListener(() => {
  console.log("[AiToEarn 执行端] 已安装/更新");
});

// 启动收尾：把上次被回收时挂着的运行标成中断，再重建所有闹钟
void (async () => {
  const interrupted = await markInterruptedRuns();
  if (interrupted > 0) console.log(`[AiToEarn 执行端] ${interrupted} 条运行记录标为中断`);
  await rebuildAllAlarms();
  await bootstrapDevice();
})();
