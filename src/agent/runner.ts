/**
 * 智能体运行核心。
 *
 * 侧边栏聊天和定时任务都走这里，区别只在于：
 * - 聊天：事件推给侧边栏界面
 * - 定时任务：事件记进运行记录，并且指定一个托管窗口
 *
 * 用的是上游 Eko 的 ChatAgent + eko-extension 的 BrowserAgent，系统提示词也用上游的。
 */
import { ChatAgent } from "@eko-ai/eko";
import type { ChatStreamMessage, AgentStreamMessage } from "@eko-ai/eko";
import { BrowserAgent } from "@eko-ai/eko-extension";
import { getSelectedModel, toLlmConfig } from "./models";
import { setupEko } from "./setup";

export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; toolCallId: string; name: string; status: "running" | "done" | "error"; detail?: string }
  | { kind: "done" }
  | { kind: "error"; error: string };

export interface RunOptions {
  /** 一次会话的 id；同一个 id 复用同一个智能体，保留上下文 */
  sessionId: string;
  text: string;
  /**
   * 透传给任务上下文的变量。传 windowId 可以把智能体钉在指定窗口里干活，
   * 不然它会用「最后聚焦的窗口」，可能抢用户正在用的那个。
   */
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

const agents = new Map<string, ChatAgent>();

async function getAgent(sessionId: string): Promise<ChatAgent> {
  const existing = agents.get(sessionId);
  if (existing) return existing;

  setupEko();
  const model = await getSelectedModel();
  if (!model) throw new Error("后端没有返回可用的模型，检查一下服务器地址和登录状态。");

  const agent = new ChatAgent(
    { llms: { default: toLlmConfig(model) }, agents: [new BrowserAgent()] },
    sessionId,
  );
  agents.set(sessionId, agent);
  return agent;
}

export function dropAgent(sessionId: string): void {
  agents.delete(sessionId);
}

/**
 * 跑一轮。Promise 在这一轮彻底结束后 resolve；
 * 结束/出错只会通过 onEvent 报一次。
 */
export async function runAgent(options: RunOptions): Promise<void> {
  const { sessionId, text, extra, signal, onEvent } = options;
  const agent = await getAgent(sessionId);
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onEvent({ kind: "done" });
  };
  const fail = (error: string) => {
    if (settled) return;
    settled = true;
    onEvent({ kind: "error", error });
  };

  const relay = (message: ChatStreamMessage | AgentStreamMessage) => {
    switch (message.type) {
      case "text":
        onEvent({ kind: "text", text: message.text });
        break;
      case "thinking":
        onEvent({ kind: "thinking", text: message.text });
        break;
      case "tool_use":
        onEvent({
          kind: "tool",
          toolCallId: message.toolCallId,
          name: message.toolName,
          status: "running",
          detail: brief(message.params),
        });
        break;
      case "tool_result":
        onEvent({
          kind: "tool",
          toolCallId: message.toolCallId,
          name: message.toolName,
          status: message.toolResult?.isError ? "error" : "done",
          detail: brief(message.toolResult?.content),
        });
        break;
      case "error":
        fail(message.error instanceof Error ? message.error.message : String(message.error));
        break;
      case "chat_end":
        if (message.error) fail(message.error);
        else finish();
        break;
      default:
        break;
    }
  };

  try {
    await agent.chat({
      messageId,
      user: [{ type: "text", text }],
      signal,
      extra,
      callback: {
        chatCallback: { onMessage: async (m) => relay(m) },
        taskCallback: {
          onMessage: async (m) => relay(m),
          // 定时任务跑的时候没人在旁边，不能停下来等人；聊天模式暂时也不弹窗
          onHumanConfirm: async () => false,
          onHumanInput: async () => "",
          onHumanSelect: async () => [],
          onHumanHelp: async () => false,
        },
      },
    });
    finish();
  } catch (err) {
    if (signal?.aborted) finish();
    else fail(err instanceof Error ? err.message : String(err));
  }
}

function brief(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return undefined;
  }
}
