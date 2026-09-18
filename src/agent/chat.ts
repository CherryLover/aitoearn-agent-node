/**
 * 侧边栏聊天：把智能体的事件推给界面。
 */
import { runAgent, type AgentEvent } from "./runner";
import type { BackgroundEvent } from "@/shared/messages";

const controllers = new Map<string, AbortController>();

function emit(event: BackgroundEvent) {
  chrome.runtime.sendMessage(event).catch(() => {
    /* 侧边栏关着的时候没人收，忽略 */
  });
}

export async function sendChat(conversationId: string, text: string): Promise<void> {
  const controller = new AbortController();
  controllers.set(conversationId, controller);

  const onEvent = (event: AgentEvent) => {
    switch (event.kind) {
      case "text":
        emit({ type: "chat:text", conversationId, text: event.text });
        break;
      case "thinking":
        emit({ type: "chat:thinking", conversationId, text: event.text });
        break;
      case "tool":
        emit({
          type: "chat:tool",
          conversationId,
          toolCallId: event.toolCallId,
          name: event.name,
          status: event.status,
          detail: event.detail,
        });
        break;
      case "done":
        emit({ type: "chat:done", conversationId });
        break;
      case "error":
        emit({ type: "chat:error", conversationId, error: event.error });
        break;
    }
  };

  // 不 await：让消息处理器立刻回包，运行过程靠事件推送
  void runAgent({ sessionId: conversationId, text, signal: controller.signal, onEvent })
    .catch((err: unknown) => {
      emit({ type: "chat:error", conversationId, error: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => controllers.delete(conversationId));
}

export function stopChat(conversationId: string): void {
  controllers.get(conversationId)?.abort();
}
