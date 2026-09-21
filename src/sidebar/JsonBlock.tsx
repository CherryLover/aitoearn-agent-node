/**
 * JsonBlock - 一块可以滚动看的内容
 *
 * 是 JSON 就缩进好再显示，不是就原样显示。
 * **不做换行折叠**：JSON 的缩进本身就是结构，折了行就看不出层级了，
 * 所以横向也给滚动条，而不是把长行挤成一坨。
 */

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { JobDetail } from "@/device/job-detail";

interface JsonBlockProps {
  title: string;
  detail: JobDetail | null;
  /** 没内容时显示的那句话 */
  empty: string;
}

export default function JsonBlock({ title, detail, empty }: JsonBlockProps) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => (detail ? prettify(detail.text) : ""), [detail]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-zinc-500">
        <span>{title}</span>
        {text && (
          <button className="ml-auto flex items-center gap-1 underline" onClick={() => void copy()}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "已复制" : "复制"}
          </button>
        )}
      </div>

      {text ? (
        <>
          <pre className="max-h-64 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
            {text}
          </pre>
          {detail?.truncated && (
            <div className="mt-1 text-amber-700 dark:text-amber-400">
              内容太长，这里只留了开头一段。
            </div>
          )}
        </>
      ) : (
        <div className="text-zinc-500">{empty}</div>
      )}
    </div>
  );
}

/**
 * 存的时候已经缩进过了，这里只兜底处理「存进来的是一行紧凑 JSON」的情况
 * （旧版本留下的记录就是这样）。解析不了就原样显示，不去猜。
 */
function prettify(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  if (trimmed.includes("\n")) return text;

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}
