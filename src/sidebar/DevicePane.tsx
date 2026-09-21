import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Download, Link2Off, ExternalLink } from "lucide-react";
import { useDeviceStore } from "./deviceStore";
import CapabilitiesSection from "./CapabilitiesSection";
import DryRunPanel from "./DryRunPanel";

export default function DevicePane() {
  const store = useDeviceStore();
  const { snapshot, error, loaded, refresh, watch } = store;

  useEffect(() => {
    void refresh();
    return watch();
  }, [refresh, watch]);

  if (!loaded || !snapshot) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        读取设备状态…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-3 py-3 text-xs">
      {snapshot.device.hasToken ? <Paired /> : <PairForm />}
      {/* 能力在配对时就要带上，所以配对前也让人先勾 */}
      <CapabilitiesSection />
      <DryRunPanel />
      {error && <div className="text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}

function PairForm() {
  const store = useDeviceStore();
  const snapshot = store.snapshot!;
  const [code, setCode] = useState("");
  const [name, setName] = useState(defaultName());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setNote(null);
    try {
      await store.pair(code, name);
      setCode("");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">配对</div>

      <label className="block">
        <span className="text-zinc-500">配对码</span>
        <input
          className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 font-mono text-sm tracking-widest outline-none dark:border-zinc-700"
          value={code}
          maxLength={16}
          placeholder="A7K2M9QP"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.trim()) void submit();
          }}
        />
      </label>

      <label className="block">
        <span className="text-zinc-500">设备名</span>
        <input
          className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-zinc-700"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-zinc-900 px-3 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          disabled={busy || !code.trim()}
          onClick={() => void submit()}
        >
          {busy ? "配对中…" : "配对"}
        </button>
        <button
          className="flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700"
          onClick={() => void chrome.tabs.create({ url: `${snapshot.homeUrl}/devices` })}
        >
          <ExternalLink className="h-3 w-3" />
          去网页取码
        </button>
      </div>

      {note && <div className="text-red-600 dark:text-red-400">{note}</div>}
    </div>
  );
}

function Paired() {
  const store = useDeviceStore();
  const snapshot = store.snapshot!;
  const { device, jobs, busy, online } = snapshot;
  const [working, setWorking] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const act = async (label: string, fn: () => Promise<string | null>) => {
    setWorking(label);
    setNote(null);
    try {
      setNote(await fn());
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            device.revoked ? "bg-red-500" : online ? "bg-emerald-500" : "bg-zinc-400"
          }`}
        />
        <span className="truncate text-sm font-medium">{device.name}</span>
        <span className="text-zinc-500">
          {device.revoked ? "已失效" : online ? "在线" : "离线"}
          {busy ? " · 干活中" : ""}
        </span>
        <button
          className="ml-auto flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-zinc-500 disabled:opacity-40 dark:border-zinc-700"
          disabled={working !== null}
          onClick={() => {
            if (confirm("解除配对？这台机器会停止领活，要重新用配对码接一次。")) {
              void act("unpair", async () => {
                await store.unpair();
                return null;
              });
            }
          }}
        >
          <Link2Off className="h-3 w-3" />
          解除配对
        </button>
      </div>

      {device.revoked && (
        <div className="rounded-md bg-red-50 px-2 py-1.5 text-red-700 dark:bg-red-950 dark:text-red-300">
          {device.revokedReason ?? "设备令牌已失效"}——解除配对后重新配一次。
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-zinc-500">
        <dt>设备 ID</dt>
        <dd className="truncate font-mono text-[11px]">{device.id ?? "—"}</dd>
        <dt>上次心跳</dt>
        <dd>
          {device.lastHeartbeatAt ? `${sinceText(device.lastHeartbeatAt)}（每 ${device.heartbeatSeconds} 秒）` : "还没发过"}
        </dd>
        <dt>上次领活</dt>
        <dd>{device.lastClaimAt ? sinceText(device.lastClaimAt) : "还没领过"}</dd>
      </dl>

      {device.lastHeartbeatError && (
        <div className="text-amber-700 dark:text-amber-400">心跳失败：{device.lastHeartbeatError}</div>
      )}
      {device.lastClaimError && (
        <div className="text-amber-700 dark:text-amber-400">领活失败：{device.lastClaimError}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
          disabled={working !== null || device.revoked}
          onClick={() =>
            void act("heartbeat", async () => {
              await store.heartbeat();
              return null;
            })
          }
        >
          <RefreshCw className={`h-3 w-3 ${working === "heartbeat" ? "animate-spin" : ""}`} />
          立即心跳
        </button>
        <button
          className="flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
          disabled={working !== null || device.revoked}
          onClick={() =>
            void act("claim", async () => {
              const worked = await store.claim();
              return worked > 0 ? `干了 ${worked} 个活` : "没有活可领";
            })
          }
        >
          <Download className={`h-3 w-3 ${working === "claim" ? "animate-pulse" : ""}`} />
          领一次活
        </button>
        {note && <span className="text-zinc-500">{note}</span>}
      </div>

      {/* 干过的活在「任务」页看：云端工单和本地定时任务是同一类东西，
          分在两个页面会让人每次都要先想「刚才那件事算哪一类」 */}
      <div className="text-zinc-500">
        {jobs.length > 0 ? `干过 ${jobs.length} 个活，` : ""}
        执行记录在「任务」页里。
      </div>
    </div>
  );
}

function defaultName(): string {
  const ua = navigator.userAgent;
  const os = ua.includes("Mac")
    ? "macOS"
    : ua.includes("Windows")
      ? "Windows"
      : ua.includes("CrOS")
        ? "ChromeOS"
        : ua.includes("Linux")
          ? "Linux"
          : "Unknown";
  return `${os} 上的 Chrome`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function sinceText(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
  return formatTime(ts);
}
