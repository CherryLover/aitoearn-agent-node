import { create } from "zustand";
import { sendToBackground } from "@/shared/messages";
import type { Task, TaskInput, TaskRun, TaskSnapshot } from "@/tasks/types";

interface TaskState {
  tasks: Task[];
  runs: Record<string, TaskRun[]>;
  activeRunId: string | null;
  queued: number;
  error: string | null;
  loaded: boolean;

  refresh: () => Promise<void>;
  watch: () => () => void;
  create: (input: TaskInput) => Promise<void>;
  update: (id: string, input: TaskInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  clearRuns: (id: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => {
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
    tasks: [],
    runs: {},
    activeRunId: null,
    queued: 0,
    error: null,
    loaded: false,

    async refresh() {
      try {
        const snapshot = await sendToBackground<TaskSnapshot>({ type: "tasks:snapshot" });
        set({ ...snapshot, loaded: true });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err), loaded: true });
      }
    },

    watch() {
      const listener = (message: { type?: string }) => {
        if (message?.type === "tasks:changed") void get().refresh();
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    },

    create: (input) => guard(() => sendToBackground({ type: "tasks:create", payload: input })),
    update: (id, input) => guard(() => sendToBackground({ type: "tasks:update", payload: { id, ...input } })),
    remove: (id) => guard(() => sendToBackground({ type: "tasks:delete", payload: { id } })),
    setEnabled: (id, enabled) => guard(() => sendToBackground({ type: "tasks:setEnabled", payload: { id, enabled } })),
    runNow: (id) => guard(() => sendToBackground({ type: "tasks:runNow", payload: { id } })),
    stop: (id) => guard(() => sendToBackground({ type: "tasks:stop", payload: { id } })),
    clearRuns: (id) => guard(() => sendToBackground({ type: "tasks:clearRuns", payload: { id } })),
  };
});
