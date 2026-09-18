import { create } from "zustand";
import type { BackgroundEvent, ModelsPayload } from "@/shared/messages";
import { sendToBackground } from "@/shared/messages";
import type { ServerConfig } from "@/shared/config";
import type { AuthState } from "@/shared/auth";
import type { ChatModel } from "@/agent/models";

export interface ToolActivity {
  toolCallId: string;
  name: string;
  status: "running" | "done" | "error";
  detail?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  tools?: ToolActivity[];
}

interface ChatState {
  conversationId: string;
  messages: ChatMessage[];
  running: boolean;
  error: string | null;

  serverConfig: ServerConfig | null;
  auth: AuthState | null;
  models: ChatModel[];
  selectedModel: string | null;
  modelsError: string | null;

  init: () => Promise<void>;
  /** 存储里的凭证变了（可能是别的标签页改的）就同步过来 */
  watchAuth: () => () => void;
  refreshModels: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  applyEvent: (event: BackgroundEvent) => void;
  saveServerConfig: (patch: Partial<ServerConfig>) => Promise<void>;
  syncAuthFromWeb: () => Promise<void>;
  setToken: (token: string) => Promise<void>;
  clearAuth: () => Promise<void>;
  selectModel: (name: string) => Promise<void>;
}

const newId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: `conv_${newId()}`,
  messages: [],
  running: false,
  error: null,

  serverConfig: null,
  auth: null,
  models: [],
  selectedModel: null,
  modelsError: null,

  async init() {
    try {
      const [config, auth] = await Promise.all([
        sendToBackground<ServerConfig>({ type: "getServerConfig" }),
        sendToBackground<AuthState>({ type: "getAuth" }),
      ]);
      set({ serverConfig: config, auth });
      await get().refreshModels();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  watchAuth() {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local" || !changes.Auth) return;
      set({ auth: (changes.Auth.newValue as AuthState | undefined) ?? null });
      void get().refreshModels();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },

  async refreshModels() {
    try {
      const { models, selected } = await sendToBackground<ModelsPayload>({ type: "listModels" });
      set({ models, selectedModel: selected, modelsError: null });
    } catch (err) {
      set({ models: [], selectedModel: null, modelsError: err instanceof Error ? err.message : String(err) });
    }
  },

  async send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || get().running) return;
    const { conversationId } = get();
    set((s) => ({
      messages: [
        ...s.messages,
        { id: newId(), role: "user", text: trimmed },
        { id: newId(), role: "assistant", text: "", tools: [] },
      ],
      running: true,
      error: null,
    }));
    try {
      await sendToBackground({ type: "chat:send", payload: { conversationId, text: trimmed } });
    } catch (err) {
      set({ running: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async stop() {
    const { conversationId } = get();
    try {
      await sendToBackground({ type: "chat:stop", payload: { conversationId } });
    } catch {
      /* 停止失败不阻塞界面 */
    }
    set({ running: false });
  },

  applyEvent(event: BackgroundEvent) {
    if (!("conversationId" in event)) return;
    if (event.conversationId !== get().conversationId) return;
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant") return s;
      switch (event.type) {
        case "chat:text":
          messages[messages.length - 1] = { ...last, text: event.text };
          return { messages };
        case "chat:thinking":
          messages[messages.length - 1] = { ...last, thinking: event.text };
          return { messages };
        case "chat:tool": {
          const tools = [...(last.tools ?? [])];
          const idx = tools.findIndex((t) => t.toolCallId === event.toolCallId);
          const next: ToolActivity = {
            toolCallId: event.toolCallId,
            name: event.name,
            status: event.status,
            detail: event.detail,
          };
          if (idx >= 0) tools[idx] = next;
          else tools.push(next);
          messages[messages.length - 1] = { ...last, tools };
          return { messages };
        }
        case "chat:done":
          return { messages, running: false };
        case "chat:error":
          return { messages, running: false, error: event.error };
        default:
          return s;
      }
    });
  },

  async saveServerConfig(patch) {
    const config = await sendToBackground<ServerConfig>({ type: "setServerConfig", payload: patch });
    set({ serverConfig: config });
    await get().refreshModels();
  },

  async syncAuthFromWeb() {
    const auth = await sendToBackground<AuthState>({ type: "syncAuthFromWeb" });
    set({ auth });
    await get().refreshModels();
  },

  async setToken(token: string) {
    const auth = await sendToBackground<AuthState>({ type: "setToken", payload: { token } });
    set({ auth });
    await get().refreshModels();
  },

  async clearAuth() {
    const auth = await sendToBackground<AuthState>({ type: "clearAuth" });
    set({ auth });
  },

  async selectModel(name: string) {
    await sendToBackground({ type: "selectModel", payload: { name } });
    set({ selectedModel: name });
  },
}));
