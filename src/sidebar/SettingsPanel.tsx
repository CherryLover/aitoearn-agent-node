import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useChatStore } from "./store";

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const store = useChatStore();
  const { serverConfig, auth, modelsError } = store;
  const [apiBase, setApiBase] = useState(serverConfig?.apiBase ?? "");
  const [homeUrl, setHomeUrl] = useState(serverConfig?.homeUrl ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNote(null);
    try {
      await fn();
      setNote("好了");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 px-3 py-3 text-xs">
      <section className="space-y-2">
        <div className="font-medium text-zinc-700 dark:text-zinc-300">服务器</div>
        <input
          className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 outline-none dark:border-zinc-700"
          value={apiBase}
          placeholder="接口地址"
          onChange={(e) => setApiBase(e.target.value)}
        />
        <input
          className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 outline-none dark:border-zinc-700"
          value={homeUrl}
          placeholder="网页地址"
          onChange={(e) => setHomeUrl(e.target.value)}
        />
        <button
          className="rounded-md bg-zinc-900 px-3 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          disabled={busy !== null}
          onClick={() => void guard("config", () => store.saveServerConfig({ apiBase, homeUrl }))}
        >
          保存
        </button>
      </section>

      <section className="space-y-2">
        <div className="font-medium text-zinc-700 dark:text-zinc-300">登录凭证</div>
        <div className="text-zinc-500">
          {auth?.token
            ? `已有凭证${auth.userName ? `（${auth.userName}）` : ""}，来源：${auth.source === "web-sync" ? "从网页同步" : "手动填写"}`
            : "还没有凭证"}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            disabled={busy !== null}
            onClick={() => void guard("sync", () => store.syncAuthFromWeb())}
          >
            {busy === "sync" ? "同步中…" : "从网页同步"}
          </button>
          {auth?.token && (
            <button
              className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
              disabled={busy !== null}
              onClick={() => void guard("clear", () => store.clearAuth())}
            >
              清除
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 outline-none dark:border-zinc-700"
            value={token}
            placeholder="或者直接粘贴凭证"
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            disabled={busy !== null || !token.trim()}
            onClick={() => void guard("token", async () => {
              await store.setToken(token);
              setToken("");
            })}
          >
            保存
          </button>
        </div>
        <p className="text-zinc-400">
          这两种拿凭证的办法都是过渡。第 3 批会改成插件自己跟服务器配对，不再依赖网页登录。
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 font-medium text-zinc-700 dark:text-zinc-300">
          模型
          <button
            className="rounded p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => void guard("models", () => store.refreshModels())}
            title="重新拉取"
          >
            <RefreshCw className={`h-3 w-3 ${busy === "models" ? "animate-spin" : ""}`} />
          </button>
        </div>
        {modelsError ? (
          <div className="text-red-600 dark:text-red-400">{modelsError}</div>
        ) : (
          <div className="text-zinc-500">{store.models.length} 个可用</div>
        )}
      </section>

      {note && <div className="text-zinc-500">{note}</div>}

      {/* 顶栏已经有返回箭头了，这里再给一个出口，翻到底的人不用再滚回去 */}
      <button className="text-zinc-400 underline" onClick={onClose}>
        返回
      </button>
    </div>
  );
}
