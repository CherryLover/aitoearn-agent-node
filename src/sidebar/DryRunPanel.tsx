/**
 * 本地试跑采集。
 *
 * 不联后台也能测：手填 entryUrl 和 spec，跑完把结果打在界面上。
 * 走的是工单同一份代码（device/jobs/sync-creator-notes 的 collect），
 * 所以试跑通过就说明工单也能通过；要是两份实现分叉了，试跑就失去意义了。
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { sendToBackground } from "@/shared/messages";
import type { SyncCreatorNotesResult } from "@/device/jobs/sync-creator-notes";

/** 小红书的默认规格，来自 docs/rebuild/contract-collect-xhs.md 的实测结果 */
const XHS_DEFAULT = {
  platform: "xhs",
  entryUrl: "https://creator.xiaohongshu.com/new/note-manager",
  spec: {
    cardSelector: ".note-card",
    titleSelector: ".note-card__title",
    timeSelector: ".note-card__time",
    statSelector: ".note-card__stat",
    metricByIconPrefix: {
      "M7.99902 3.83398": "views",
      "M3.18233 10.985": "comments",
      "M3.25611 3.91336": "likes",
      "M10.8848 14.2322": "collects",
      "M8.28672 5.15797": "shares",
    },
    totalCountPattern: "^全部\\s*(\\d+)$",
    maxScrolls: 40,
    scrollSettleMs: 1500,
  },
};

export default function DryRunPanel() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(XHS_DEFAULT, null, 2));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncCreatorNotesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      setError(`载荷不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
      return;
    }
    try {
      setResult(await sendToBackground<SyncCreatorNotesResult>({ type: "device:dryRunCollect", payload }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <button
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-zinc-500"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        本地试跑采集（不经过后台）
      </button>

      {open && (
        <div className="space-y-2 border-t border-zinc-200 px-2 py-2 dark:border-zinc-800">
          <div className="text-[11px] text-zinc-400">
            会开一个不聚焦的托管窗口跑完再关掉。要先在这个浏览器里登录目标平台。
          </div>
          <textarea
            className="h-44 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 font-mono text-[11px] outline-none dark:border-zinc-700"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              disabled={busy}
              onClick={() => void run()}
            >
              <Play className="h-3 w-3" />
              {busy ? "跑着…（最多 3 分钟）" : "试跑"}
            </button>
            <button
              className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-500 dark:border-zinc-700"
              onClick={() => setText(JSON.stringify(XHS_DEFAULT, null, 2))}
            >
              恢复默认
            </button>
          </div>

          {error && <div className="text-red-600 dark:text-red-400">{error}</div>}
          {result && <DryRunResult result={result} />}
        </div>
      )}
    </div>
  );
}

function DryRunResult({ result }: { result: SyncCreatorNotesResult }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-500">
        <span>
          读到 <b className="text-zinc-900 dark:text-zinc-100">{result.loadedCount}</b> 条
        </span>
        {result.totalClaimed !== null && <span>页面声称 {result.totalClaimed} 条</span>}
        <span>{result.reachedEnd ? "已滚到底" : "没确认到底"}</span>
        {result.accountHint && <span>账号 {result.accountHint}</span>}
      </div>

      {result.warnings.map((w) => (
        <div key={w} className="text-amber-700 dark:text-amber-400">
          {w}
        </div>
      ))}

      <div className="max-h-64 space-y-1 overflow-y-auto">
        {result.notes.map((note, i) => (
          <div key={`${note.title}_${i}`} className="rounded border border-zinc-200 px-2 py-1 dark:border-zinc-800">
            <div className="truncate">
              {note.title || <span className="text-zinc-400">（没读到标题）</span>}
              {note.titleTruncated && <span className="ml-1 text-[10px] text-zinc-400">标题被截断</span>}
            </div>
            <div className="text-[11px] text-zinc-500">{note.publishedAtText}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-zinc-500">
              {Object.entries(note.metrics).map(([k, v]) => (
                <span key={k}>
                  {METRIC_LABEL[k] ?? k} <b className="text-zinc-900 dark:text-zinc-100">{v}</b>
                </span>
              ))}
            </div>
          </div>
        ))}

        {result.unrecognized.map((note, i) => (
          <div
            key={`u_${note.title}_${i}`}
            className="rounded border border-amber-300 px-2 py-1 dark:border-amber-800"
          >
            <div className="truncate">{note.title || "（没读到标题）"}</div>
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              认不出指标，没有猜值。原始数字：{note.rawNumbers.join(" / ") || "无"}
            </div>
            {note.unknownPrefixes.length > 0 && (
              <div className="font-mono text-[10px] break-all text-zinc-500">
                {note.unknownPrefixes.join("  ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const METRIC_LABEL: Record<string, string> = {
  views: "浏览",
  comments: "评论",
  likes: "点赞",
  collects: "收藏",
  shares: "分享",
};
