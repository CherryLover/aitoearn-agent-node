/**
 * 这台机器能干哪些平台的活。
 *
 * 服务端派活时按 requiredCapability 过滤设备，所以这里一个都不勾，
 * 带平台要求的工单就永远轮不到这台机器——界面上要把这件事说明白，
 * 不然用户会以为「配对了就该有活」。
 */
import { useState } from "react";
import { Radar, Check } from "lucide-react";
import { useDeviceStore } from "./deviceStore";

export default function CapabilitiesSection() {
  const store = useDeviceStore();
  const snapshot = store.snapshot!;
  const { capabilities, knownPlatforms, supportedJobTypes, canDetect } = snapshot;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const toggle = async (id: string) => {
    const next = capabilities.includes(id)
      ? capabilities.filter((c) => c !== id)
      : [...capabilities, id];
    setNote(null);
    await store.setCapabilities(next);
  };

  const detect = async () => {
    setBusy(true);
    setNote(null);
    try {
      // cookies 是可选权限，申请必须由用户手势触发，所以在这里要，不在后台要
      if (!canDetect) {
        const granted = await chrome.permissions.request({ permissions: ["cookies"] });
        if (!granted) {
          setNote("没有 Cookie 权限就没法自动探测，手动勾选也一样能用");
          return;
        }
      }
      const detected = await store.detectCapabilities();
      const loggedIn = detected.filter((d) => d.loggedIn);
      setNote(
        loggedIn.length > 0
          ? `探测到已登录：${loggedIn.map((d) => d.name).join("、")}`
          : "一个登录着的平台都没探测到，先去平台登录一次",
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-zinc-200 px-2 py-2 dark:border-zinc-800">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-zinc-500">这台机器能干的平台</span>
        <button
          className="ml-auto flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-0.5 disabled:opacity-40 dark:border-zinc-700"
          disabled={busy}
          onClick={() => void detect()}
        >
          <Radar className={`h-3 w-3 ${busy ? "animate-pulse" : ""}`} />
          {canDetect ? "探测登录状态" : "允许探测"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {knownPlatforms.map((platform) => {
          const on = capabilities.includes(platform.id);
          return (
            <button
              key={platform.id}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                on
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "border-zinc-300 text-zinc-500 dark:border-zinc-700"
              }`}
              onClick={() => void toggle(platform.id)}
            >
              {on && <Check className="h-3 w-3" />}
              {platform.name}
            </button>
          );
        })}
      </div>

      {capabilities.length === 0 && (
        <div className="mt-1.5 text-amber-700 dark:text-amber-400">
          一个都没勾：指定了平台的工单不会派到这台机器上，只能领不限平台的活（比如 echo）。
        </div>
      )}
      {note && <div className="mt-1.5 text-zinc-500">{note}</div>}

      <div className="mt-1.5 text-[11px] text-zinc-400">
        会干的工单类型：{supportedJobTypes.join("、")}
      </div>
    </div>
  );
}
