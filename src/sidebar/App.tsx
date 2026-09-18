import { useCallback, useEffect, useState } from "react";
import { Settings } from "lucide-react";
import ChatPane from "./ChatPane";
import TasksPane from "./TasksPane";
import SettingsPanel from "./SettingsPanel";
import SetupGate, { SetupChecking } from "./SetupGate";
import { useChatStore } from "./store";
import { sendToBackground, type SetupStatus } from "@/shared/messages";

type Tab = "chat" | "tasks";

export default function App() {
  const store = useChatStore();
  const { models, selectedModel, init } = store;
  const [tab, setTab] = useState<Tab>("chat");
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);

  const check = useCallback(async () => {
    try {
      setStatus(await sendToBackground<SetupStatus>({ type: "checkSetup" }));
    } catch {
      // 后台没起来时给一个「全不通」的状态，界面照样能显示引导
      setStatus({
        server: { ok: false, message: "插件后台没响应，在扩展管理页重新加载一次插件" },
        auth: { ok: false, message: "等服务器连通后再查" },
        model: { ok: false, message: "等服务器连通后再查", count: 0 },
        ready: false,
        apiBase: "",
        homeUrl: "",
      });
    }
  }, []);

  useEffect(() => {
    void check();
    // 配置或凭证被改了（可能是设置面板、也可能是别的标签页）就重查一遍
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && (changes.Auth || changes.ServerConfig)) void check();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [check]);

  useEffect(() => {
    if (status?.ready) void init();
  }, [status?.ready, init]);

  if (!status) return <SetupChecking />;
  if (!status.ready) return <SetupGate status={status} onRecheck={check} />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-1">
          <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
            聊天
          </TabButton>
          <TabButton active={tab === "tasks"} onClick={() => setTab("tasks")}>
            任务
          </TabButton>
        </div>
        <div className="flex items-center gap-2">
          {models.length > 0 && (
            <select
              className="max-w-28 rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
              value={selectedModel ?? ""}
              onChange={(e) => void store.selectModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.description || m.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => setShowSettings((v) => !v)}
            title="设置"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* 两个面板都保持挂载：切到任务页再切回来，对话不会没了 */}
      <div className={`min-h-0 flex-1 ${tab === "chat" ? "" : "hidden"}`}>
        <ChatPane />
      </div>
      <div className={`min-h-0 flex-1 ${tab === "tasks" ? "" : "hidden"}`}>
        <TasksPane />
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`rounded-md px-2.5 py-1 text-sm ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
