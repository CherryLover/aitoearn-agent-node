import { useEffect, useState } from "react";
import { Check, X, Loader2, RefreshCw } from "lucide-react";
import { sendToBackground, type SetupStatus } from "@/shared/messages";
import type { AuthState } from "@/shared/auth";
import type { ServerConfig } from "@/shared/config";

/**
 * 没配好就不让用。
 *
 * 每次打开都重新查一遍，而不是配完一次就当永远有效——凭证会过期，
 * 服务器地址也可能改，早点发现比调模型时才报错好。
 */
export default function SetupGate({
  status,
  onRecheck,
}: {
  status: SetupStatus;
  onRecheck: () => Promise<void>;
}) {
  const [apiBase, setApiBase] = useState(status.apiBase);
  const [homeUrl, setHomeUrl] = useState(status.homeUrl);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setApiBase(status.apiBase);
    setHomeUrl(status.homeUrl);
  }, [status.apiBase, status.homeUrl]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNote(null);
    try {
      await fn();
      await onRecheck();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const serverDone = status.server.ok && status.model.ok;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-5">
      <h1 className="text-base font-medium">先配置一下</h1>
      <p className="mt-1 text-xs text-zinc-500">
        配好这两步才能开始用。每次打开插件都会重新检查一遍。
      </p>

      <ol className="mt-5 space-y-5">
        <Step
          index={1}
          title="连上你的服务器"
          state={status.server.ok ? (status.model.ok ? "ok" : "warn") : "fail"}
          message={status.server.ok ? status.model.message : status.server.message}
        >
          <label className="mt-2 block text-xs text-zinc-500">
            接口地址
            <input
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-zinc-700"
              value={apiBase}
              placeholder="https://你的域名/api"
              onChange={(e) => setApiBase(e.target.value)}
            />
          </label>
          <label className="mt-2 block text-xs text-zinc-500">
            网页地址
            <input
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-zinc-700"
              value={homeUrl}
              placeholder="https://你的域名"
              onChange={(e) => setHomeUrl(e.target.value)}
            />
          </label>
          <button
            className="mt-2 rounded-md bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            disabled={busy !== null}
            onClick={() =>
              void run("server", async () => {
                await sendToBackground<ServerConfig>({
                  type: "setServerConfig",
                  payload: { apiBase, homeUrl },
                });
              })
            }
          >
            {busy === "server" ? "保存中…" : "保存并检查"}
          </button>
        </Step>

        <Step
          index={2}
          title="拿到登录凭证"
          state={status.auth.ok ? "ok" : "fail"}
          message={status.auth.message}
          disabled={!serverDone}
        >
          <p className="mt-2 text-xs text-zinc-500">
            去 {shortHost(status.homeUrl)} 登录后，点下面的按钮把登录状态同步过来。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="rounded-md bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              disabled={busy !== null || !serverDone}
              onClick={() =>
                void run("sync", async () => {
                  await sendToBackground<AuthState>({ type: "syncAuthFromWeb" });
                })
              }
            >
              {busy === "sync" ? "同步中…" : "从网页同步"}
            </button>
            <button
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs disabled:opacity-40 dark:border-zinc-700"
              disabled={busy !== null || !serverDone}
              onClick={() => void chrome.tabs.create({ url: status.homeUrl })}
            >
              打开网页登录
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs outline-none dark:border-zinc-700"
              value={token}
              placeholder="或者直接粘贴凭证"
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-zinc-700"
              disabled={busy !== null || !token.trim()}
              onClick={() =>
                void run("token", async () => {
                  await sendToBackground<AuthState>({ type: "setToken", payload: { token } });
                  setToken("");
                })
              }
            >
              保存
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            这两种办法都是过渡。以后会改成插件自己跟服务器配对，不再依赖网页登录。
          </p>
        </Step>
      </ol>

      {note && <div className="mt-4 text-xs text-red-600 dark:text-red-400">{note}</div>}

      <button
        className="mt-6 flex items-center gap-1.5 self-start text-xs text-zinc-500 underline"
        disabled={busy !== null}
        onClick={() => void run("recheck", async () => {})}
      >
        <RefreshCw className={`h-3 w-3 ${busy === "recheck" ? "animate-spin" : ""}`} />
        重新检查
      </button>
    </div>
  );
}

function Step({
  index, title, state, message, disabled, children,
}: {
  index: number;
  title: string;
  state: "ok" | "warn" | "fail";
  message: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={disabled ? "opacity-40" : ""}>
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
            state === "ok"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {state === "ok" ? <Check className="h-3 w-3" /> : index}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="mt-1 flex items-start gap-1.5 pl-7 text-xs">
        {state === "ok" ? (
          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
        ) : (
          <X className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" />
        )}
        <span className={state === "ok" ? "text-zinc-500" : "text-amber-700 dark:text-amber-400"}>
          {message}
        </span>
      </div>
      <div className="pl-7">{children}</div>
    </li>
  );
}

export function SetupChecking() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      正在检查配置…
    </div>
  );
}

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
