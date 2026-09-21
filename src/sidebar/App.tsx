import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Settings } from "lucide-react";
import ChatPane from "./ChatPane";
import TasksPane from "./TasksPane";
import DevicePane from "./DevicePane";
import SettingsPanel from "./SettingsPanel";
import SetupGate, { SetupChecking } from "./SetupGate";
import { useChatStore } from "./store";
import { sendToBackground, type SetupStatus } from "@/shared/messages";

type Tab = "chat" | "tasks" | "device";

/**
 * 当前这一层显示什么。
 *
 * 设置是**盖在内容上**的一层，不是插在标签栏和内容之间的一块：
 * 原来那样是把设置面板和当前标签页的内容上下堆着，内容被挤到下面半屏，
 * 人既看不全设置也看不全内容，还搞不清自己在哪一层。
 */
type View = { kind: "tab" } | { kind: "settings" };

export default function App() {
  const store = useChatStore();
  const { models, selectedModel, init } = store;
  const [tab, setTab] = useState<Tab>("chat");
  const [view, setView] = useState<View>({ kind: "tab" });
  const [status, setStatus] = useState<SetupStatus | null>(null);
  /** 用户在引导页上选了「只领活」：这一趟先放行，进去配对 */
  const [skipToPairing, setSkipToPairing] = useState(false);

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
        devicePaired: false,
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
      if (area === "local" && (changes.Auth || changes.ServerConfig || changes.Device)) void check();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [check]);

  useEffect(() => {
    if (status?.ready) void init();
  }, [status?.ready, init]);

  // 没有登录凭证时默认落在设备页：这台机器多半只是拿来领活的
  useEffect(() => {
    if (status && !status.auth.ok) setTab("device");
  }, [status?.auth.ok]);

  if (!status) return <SetupChecking />;

  /**
   * 配对不需要网页登录凭证，所以「已经配过对」和「用户说了只领活」这两种情况要放行，
   * 不然一台只干活的机器会被卡在引导页，连配对入口都摸不到。
   */
  const canUse = status.ready || status.devicePaired || skipToPairing;
  if (!canUse) {
    return (
      <SetupGate
        status={status}
        onRecheck={check}
        onPairInstead={() => {
          setSkipToPairing(true);
          setTab("device");
          setView({ kind: "tab" });
        }}
      />
    );
  }

  const inSettings = view.kind === "settings";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {inSettings ? (
          <div className="flex items-center gap-2">
            <button
              className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => setView({ kind: "tab" })}
              title="返回"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">设置</span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
              聊天
            </TabButton>
            <TabButton active={tab === "tasks"} onClick={() => setTab("tasks")}>
              任务
            </TabButton>
            <TabButton active={tab === "device"} onClick={() => setTab("device")}>
              设备
            </TabButton>
          </div>
        )}
        <div className="flex items-center gap-2">
          {!inSettings && models.length > 0 && (
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
          {!inSettings && (
            <button
              className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => setView({ kind: "settings" })}
              title="设置"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {!inSettings && !status.auth.ok && tab !== "device" && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span className="flex-1">没有登录凭证，聊天和定时任务用不了</span>
          <button className="underline" onClick={() => setView({ kind: "settings" })}>
            去配置
          </button>
        </div>
      )}

      {/*
        只有一个内容区，谁在上面谁占满整块。
        三个标签页都保持挂载（切到别处再切回来，对话和滚动位置不会没了），
        靠 hidden 切换；设置盖在最上面，靠的是从内容区里整个换掉，
        而不是再往下堆一块。
      */}
      <div className="relative min-h-0 flex-1">
        <div className={`absolute inset-0 ${tab === "chat" && !inSettings ? "" : "hidden"}`}>
          <ChatPane />
        </div>
        <div className={`absolute inset-0 ${tab === "tasks" && !inSettings ? "" : "hidden"}`}>
          <TasksPane />
        </div>
        <div className={`absolute inset-0 ${tab === "device" && !inSettings ? "" : "hidden"}`}>
          <DevicePane />
        </div>
        {inSettings && (
          <div className="absolute inset-0 overflow-y-auto bg-white dark:bg-zinc-950">
            <SettingsPanel onClose={() => setView({ kind: "tab" })} />
          </div>
        )}
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
