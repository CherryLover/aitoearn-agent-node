/**
 * 模型接入。
 *
 * 自部署的 AiToEarn 后端提供这几个入口：
 *   GET  {apiBase}/ai/models/chat?scene=plugin   模型列表（不要凭证）
 *   POST {apiBase}/ai/chat/stream                OpenAI 兼容格式
 *   POST {apiBase}/ai/chat/claude                Anthropic Messages 格式
 *
 * 做法：给 Eko 一份 openai-compatible 的 LLM 配置，apiKey 留空，换掉 fetch，
 * 把 SDK 想发给模型厂商的请求改道到自己的后端并带上 Bearer。
 */
import type { LLMConfig } from "@eko-ai/eko";
import { loadServerConfig } from "@/shared/config";
import { withAuthHeaders } from "@/shared/auth";

export interface ChatModel {
  name: string;
  description?: string;
  channel?: string;
  tags?: string[];
  scenes?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
}

export const SELECTED_MODEL_KEY = "SelectedModel";

export async function fetchChatModels(): Promise<ChatModel[]> {
  const { apiBase } = await loadServerConfig();
  const res = await fetch(`${apiBase}/ai/models/chat?scene=plugin`, {
    headers: await withAuthHeaders({ "Content-Type": "application/json" }),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`拉模型列表失败：${res.status} ${res.statusText}`);
  if (json.code && json.code !== 0 && json.code !== 200) {
    throw new Error(json.message || `拉模型列表失败（code ${json.code}）`);
  }
  const list = (json.data ?? json) as ChatModel[];
  if (!Array.isArray(list)) throw new Error("模型列表格式不对");
  return list;
}

export async function getSelectedModel(): Promise<ChatModel | null> {
  const models = await fetchChatModels();
  if (models.length === 0) return null;
  const stored = await chrome.storage.local.get(SELECTED_MODEL_KEY);
  const wanted = stored[SELECTED_MODEL_KEY] as string | undefined;
  return models.find((m) => m.name === wanted) ?? models[0];
}

export async function setSelectedModel(name: string): Promise<void> {
  await chrome.storage.local.set({ [SELECTED_MODEL_KEY]: name });
}

/**
 * 有些后端在流式返回 tool_calls 时不带 index，AI SDK 会解析不出来，这里补上。
 * 逐块做正则替换的话，一个 `"tool_calls":[{` 被切在两块之间就漏掉了，
 * 所以末尾留一点缓冲，保证跨块也能匹配上。
 */
function fixToolCallIndexStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const NEEDLE = '"tool_calls":[{';
  let carry = "";
  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = carry + decoder.decode(value, { stream: true });
        // 末尾留下可能被截断的一小段，等下一块拼上再处理
        const keep = Math.min(NEEDLE.length - 1, chunk.length);
        const emit = chunk.slice(0, chunk.length - keep);
        carry = chunk.slice(chunk.length - keep);
        if (emit) controller.enqueue(encoder.encode(patch(emit)));
      }
      if (carry) controller.enqueue(encoder.encode(patch(carry)));
      controller.close();
    },
  });

  function patch(text: string) {
    return text.replace(/"tool_calls":\s*\[\s*\{(?!"index")/g, '"tool_calls":[{"index":0,');
  }
}

/** 把一个模型条目变成 Eko 能用的 LLM 配置 */
export function toLlmConfig(model: ChatModel): LLMConfig {
  const isClaude = model.channel === "anthropic";
  return {
    provider: "openai-compatible",
    model: model.name,
    apiKey: "",
    config: {
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    },
    fetch: async (_ignoredUrl, init) => {
      const { apiBase } = await loadServerConfig();
      const url = `${apiBase}${isClaude ? "/ai/chat/claude" : "/ai/chat/stream"}`;
      const headers = await withAuthHeaders(init?.headers);
      const response = await globalThis.fetch(url, { ...init, headers });

      // 后端出错时返回 JSON（HTTP 仍是 200），要翻译成 AI SDK 认得的错误
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const text = await response.text();
        let code: number | undefined;
        let message = text;
        try {
          const json = JSON.parse(text);
          code = json.code;
          message = json.message || text;
        } catch {
          /* 不是标准错误体，原样往下传 */
        }
        if (code && code !== 0 && code !== 200) {
          const status = code === 401 ? 401 : 400;
          return new Response(
            JSON.stringify({ error: { message, type: "invalid_request_error", code } }),
            { status, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(text, { status: response.status, headers: response.headers });
      }

      if (!response.ok) {
        const text = await response.text();
        return new Response(
          JSON.stringify({ error: { message: text || response.statusText, type: "invalid_request_error", code: response.status } }),
          { status: response.status, headers: { "content-type": "application/json" } },
        );
      }

      return response.body
        ? new Response(fixToolCallIndexStream(response.body), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        : response;
    },
  };
}
