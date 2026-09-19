import { create } from "zustand";
import { sendToBackground, type DeviceSnapshot } from "@/shared/messages";

interface DeviceStoreState {
  snapshot: DeviceSnapshot | null;
  error: string | null;
  loaded: boolean;

  refresh: () => Promise<void>;
  watch: () => () => void;
  /** 配对失败要在表单上就地报错，所以这个不吞异常 */
  pair: (code: string, name: string) => Promise<void>;
  unpair: () => Promise<void>;
  heartbeat: () => Promise<void>;
  claim: () => Promise<number>;
  clearJobs: () => Promise<void>;
}

export const useDeviceStore = create<DeviceStoreState>((set, get) => {
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      set({ error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
    await get().refresh();
  };

  return {
    snapshot: null,
    error: null,
    loaded: false,

    async refresh() {
      try {
        set({ snapshot: await sendToBackground<DeviceSnapshot>({ type: "device:snapshot" }), loaded: true });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err), loaded: true });
      }
    },

    watch() {
      const listener = (message: { type?: string }) => {
        if (message?.type === "device:changed") void get().refresh();
      };
      chrome.runtime.onMessage.addListener(listener);
      // 心跳只改存储、不发消息的情况也有，隔一会儿自己刷一次，让「上次心跳」不至于看着像卡住
      const timer = setInterval(() => void get().refresh(), 15_000);
      return () => {
        chrome.runtime.onMessage.removeListener(listener);
        clearInterval(timer);
      };
    },

    async pair(code, name) {
      await sendToBackground({ type: "device:pair", payload: { code, name } });
      set({ error: null });
      await get().refresh();
    },

    unpair: () => guard(() => sendToBackground({ type: "device:unpair" })),
    heartbeat: () => guard(() => sendToBackground({ type: "device:heartbeat" })),
    clearJobs: () => guard(() => sendToBackground({ type: "device:clearJobs" })),

    async claim() {
      try {
        const res = await sendToBackground<{ worked: number }>({ type: "device:claim" });
        set({ error: null });
        await get().refresh();
        return res.worked;
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
        await get().refresh();
        return 0;
      }
    },
  };
});
