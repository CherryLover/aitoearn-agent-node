/**
 * RecordsPane - 执行记录：插件替你干过的活，云端工单和本地定时任务合在一起
 *
 * 列表点开是详情，详情里能看到**要它干什么**和**它最后交了什么上去**。
 * 这两样是排查一次失败时唯一有用的东西：光看「失败了」和一行摘要，
 * 判断不出是派下来的参数不对，还是干出来的结果不对。
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Cloud, Loader2, Monitor, Trash2 } from "lucide-react";
import { useDeviceStore } from "./deviceStore";
import { useTaskStore } from "./taskStore";
import JsonBlock from "./JsonBlock";
import { mergeRecords, type ExecutionRecord } from "./records";

const OUTCOME_TEXT = { running: "干着", success: "成功", failed: "失败", dropped: "已丢弃" };
const OUTCOME_TONE = {
  running: "text-blue-600",
  success: "text-emerald-600",
  failed: "text-red-600",
  dropped: "text-zinc-500",
};

export default function RecordsPane() {
  const device = useDeviceStore();
  const tasks = useTaskStore();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // 两条线各自订阅一次：这一页可能是用户打开插件后唯一看的一页，
  // 不能指望设备页或定时任务页已经帮忙拉过数据
  const { refresh: refreshDevice, watch: watchDevice } = device;
  const { refresh: refreshTasks, watch: watchTasks } = tasks;
  useEffect(() => {
    void refreshDevice();
    return watchDevice();
  }, [refreshDevice, watchDevice]);
  useEffect(() => {
    void refreshTasks();
    return watchTasks();
  }, [refreshTasks, watchTasks]);

  const records = useMemo(
    () => mergeRecords(device.snapshot?.jobs ?? [], tasks.runs, tasks.tasks),
    [device.snapshot?.jobs, tasks.runs, tasks.tasks],
  );

  const opened = records.find((record) => record.key === openKey) ?? null;
  if (opened) return <RecordDetail record={opened} onBack={() => setOpenKey(null)} />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        <span>{records.length > 0 ? `${records.length} 条记录` : "执行记录"}</span>
        {(device.snapshot?.jobs.length ?? 0) > 0 && (
          <button className="flex items-center gap-1 underline" onClick={() => void device.clearJobs()}>
            <Trash2 className="h-3 w-3" />
            清空工单记录
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {records.length === 0 ? (
          <div className="mt-16 text-center text-sm text-zinc-500">
            <p>还没干过活</p>
            <p className="mt-1 text-xs">服务端派下来的工单和本地定时任务跑过之后都会记在这里。</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {records.map((record) => (
              <RecordRow key={record.key} record={record} onOpen={() => setOpenKey(record.key)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecordRow({ record, onOpen }: { record: ExecutionRecord; onOpen: () => void }) {
  const Icon = record.source === "cloud" ? Cloud : Monitor;

  return (
    <button
      className="w-full rounded border border-zinc-200 px-2 py-1.5 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      onClick={onOpen}
    >
      <div className="flex items-center gap-2 text-xs">
        {record.outcome === "running" ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-600" />
        ) : (
          <Icon className="h-3 w-3 shrink-0 text-zinc-400" />
        )}
        <span className={OUTCOME_TONE[record.outcome]}>{OUTCOME_TEXT[record.outcome]}</span>
        <span className="truncate font-mono text-[11px] text-zinc-500">{record.title}</span>
        <span className="ml-auto shrink-0 text-zinc-400">{formatTime(record.startedAt)}</span>
      </div>
      {(record.error || record.summary) && (
        <div
          className={`mt-1 line-clamp-2 text-xs ${
            record.error ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"
          }`}
        >
          {record.error ?? record.summary}
        </div>
      )}
    </button>
  );
}

function RecordDetail({ record, onBack }: { record: ExecutionRecord; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <button className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onBack} title="返回">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm font-medium">{record.title}</span>
        <span className={`ml-auto shrink-0 text-xs ${OUTCOME_TONE[record.outcome]}`}>
          {OUTCOME_TEXT[record.outcome]}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-zinc-500">
          <dt>来源</dt>
          <dd>{record.source === "cloud" ? "服务端派的工单" : "本地定时任务"}</dd>
          <dt>开始</dt>
          <dd>{formatDateTime(record.startedAt)}</dd>
          <dt>耗时</dt>
          <dd>
            {record.finishedAt
              ? `${((record.finishedAt - record.startedAt) / 1000).toFixed(1)} 秒`
              : "还没结束"}
          </dd>
          {record.facts.map((fact) => (
            <Fact key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </dl>

        {record.error && (
          <div className="rounded-md bg-red-50 px-2 py-1.5 text-red-700 dark:bg-red-950 dark:text-red-300">
            {record.error}
          </div>
        )}

        <JsonBlock
          title={record.source === "cloud" ? "派下来的内容" : "要它干的事"}
          detail={record.input}
          empty="这次没有留下载荷"
        />

        <JsonBlock
          title={record.source === "cloud" ? "回报上去的内容" : "最终输出"}
          detail={record.output}
          empty={record.outcome === "running" ? "还没跑完" : "没有回报内容"}
        />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="truncate font-mono text-[11px]" title={value}>
        {value}
      </dd>
    </>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(ts)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
