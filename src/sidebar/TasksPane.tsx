import { useEffect, useState } from "react";
import {
  Play, Square, Pause, PlayCircle, Pencil, Trash2, Plus, ChevronDown, ChevronRight, Loader2,
} from "lucide-react";
import { useTaskStore } from "./taskStore";
import type { Task, TaskInput, TaskRun } from "@/tasks/types";
import RecordsPane from "./RecordsPane";

type Section = "records" | "schedule";

/**
 * TasksPane - 「任务」页
 *
 * 两样东西放在一起：服务端派下来的工单和本地的定时任务。
 * 它们在用户眼里都是「插件替我干的活」，区别只是谁派的，
 * 所以**执行记录是合在一起的一个列表**，只有「管定时任务」才单独一段。
 *
 * 默认落在记录上：绝大多数时候人打开这一页是想看「刚才那件事干成了没有」，
 * 而不是来改定时规则的。
 */
export default function TasksPane() {
  const [section, setSection] = useState<Section>("records");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <SectionButton active={section === "records"} onClick={() => setSection("records")}>
          执行记录
        </SectionButton>
        <SectionButton active={section === "schedule"} onClick={() => setSection("schedule")}>
          定时任务
        </SectionButton>
      </div>

      <div className="min-h-0 flex-1">
        {section === "records" ? <RecordsPane /> : <SchedulePane />}
      </div>
    </div>
  );
}

function SectionButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`rounded-md px-2 py-0.5 text-xs ${
        active
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}


function SchedulePane() {
  const store = useTaskStore();
  const { tasks, runs, queued, error, loaded, refresh, watch } = store;
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    return watch();
  }, [refresh, watch]);

  if (editing) {
    return (
      <TaskEditor
        task={editing === "new" ? null : editing}
        onCancel={() => setEditing(null)}
        onSave={async (input) => {
          if (editing === "new") await store.create(input);
          else await store.update(editing.id, input);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="text-xs text-zinc-500">
          {tasks.length} 个任务{queued > 0 ? `，${queued} 个排队中` : ""}
        </div>
        <button
          className="flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
          onClick={() => setEditing("new")}
        >
          <Plus className="h-3 w-3" />
          新建任务
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {loaded && tasks.length === 0 && (
          <div className="mt-16 text-center text-sm text-zinc-500">
            <p>还没有定时任务</p>
            <p className="mt-1 text-xs">建一个之后，插件就能每天自动帮你跑它。</p>
          </div>
        )}

        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              runs={runs[task.id] ?? []}
              expanded={expanded === task.id}
              onToggle={() => setExpanded(expanded === task.id ? null : task.id)}
              onEdit={() => setEditing(task)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task, runs, expanded, onToggle, onEdit,
}: {
  task: Task;
  runs: TaskRun[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const store = useTaskStore();
  const running = task.status === "running";
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-start gap-2 px-3 py-2">
        <button className="mt-0.5 text-zinc-400" onClick={onToggle} title="运行记录">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{task.title}</span>
            <StatusBadge status={task.status} />
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {task.scheduleType === "daily" ? `每天 ${task.dailyTime}` : "仅手动"}
            {task.nextRunAt ? ` · 下次 ${formatTime(task.nextRunAt)}` : ""}
            {task.lastRunAt ? ` · 上次 ${formatTime(task.lastRunAt)}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {running ? (
            <IconButton title="停止" onClick={() => void store.stop(task.id)}>
              <Square className="h-3.5 w-3.5" />
            </IconButton>
          ) : (
            <IconButton title="立即执行" onClick={() => void store.runNow(task.id)}>
              <Play className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <IconButton
            title={task.enabled ? "暂停" : "恢复"}
            onClick={() => void store.setEnabled(task.id, !task.enabled)}
          >
            {task.enabled ? <Pause className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton title="编辑" onClick={onEdit} disabled={running}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            title="删除"
            disabled={running}
            onClick={() => {
              if (confirm(`删除「${task.title}」？运行记录也会一起清掉，撤不回来。`)) void store.remove(task.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <div className="mb-2 whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {task.prompt}
          </div>
          {runs.length === 0 ? (
            <div className="text-xs text-zinc-500">暂无运行记录。</div>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
                <span>运行记录</span>
                <button className="underline" onClick={() => void store.clearRuns(task.id)}>
                  清空
                </button>
              </div>
              <div className="space-y-2">
                {runs.map((run) => (
                  <RunCard key={run.id} run={run} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RunCard({ run }: { run: TaskRun }) {
  const [open, setOpen] = useState(false);
  const color =
    run.status === "success" ? "text-emerald-600"
    : run.status === "failed" ? "text-red-600"
    : run.status === "running" ? "text-blue-600"
    : "text-zinc-500";
  const label = {
    queued: "排队中", running: "运行中", success: "成功",
    failed: "失败", interrupted: "中断", stopped: "已停止",
  }[run.status];
  return (
    <div className="rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-800">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        {run.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-blue-600" />}
        <span className={color}>{label}</span>
        <span className="text-zinc-500">{run.trigger === "scheduled" ? "定时触发" : "手动触发"}</span>
        <span className="ml-auto text-zinc-400">{formatTime(run.startedAt)}</span>
      </button>
      {run.summary && <div className="mt-1 text-zinc-600 dark:text-zinc-400">{run.summary}</div>}
      {open && (
        <div className="mt-2 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          {run.finishedAt && (
            <div className="text-zinc-500">耗时 {Math.round((run.finishedAt - run.startedAt) / 1000)} 秒</div>
          )}
          {run.steps.length > 0 && (
            <div className="space-y-0.5">
              {run.steps.map((step, i) => (
                <div key={i} className="text-zinc-500">
                  {step.kind === "tool" && `· ${step.name}${step.status === "error" ? "（失败）" : ""}`}
                  {step.kind === "error" && <span className="text-red-600">· {step.text}</span>}
                  {step.kind === "text" && <span className="text-zinc-700 dark:text-zinc-300">{step.text}</span>}
                </div>
              ))}
            </div>
          )}
          {run.error && <div className="text-red-600">{run.error}</div>}
        </div>
      )}
    </div>
  );
}

function TaskEditor({
  task, onSave, onCancel,
}: {
  task: Task | null;
  onSave: (input: TaskInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [scheduleType, setScheduleType] = useState<TaskInput["scheduleType"]>(task?.scheduleType ?? "daily");
  const [dailyTime, setDailyTime] = useState(task?.dailyTime ?? "09:00");
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3 text-xs">
      <div className="mb-2 text-sm font-medium">{task ? "编辑任务" : "新建任务"}</div>
      <p className="mb-3 text-zinc-500">定义任务标题和提示词，选每天几点跑还是只手动跑。</p>

      <label className="mb-2 block">
        <span className="text-zinc-500">任务标题</span>
        <input
          className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-zinc-700"
          value={title}
          placeholder="例如：每天看一眼 X 首页"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="mb-2 block">
        <span className="text-zinc-500">任务提示词</span>
        <textarea
          className="mt-1 w-full resize-y rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-zinc-700"
          rows={5}
          value={prompt}
          placeholder="描述执行目标、约束条件和预期结果。"
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      <div className="mb-2 flex items-center gap-2">
        <span className="text-zinc-500">调度</span>
        <select
          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          value={scheduleType}
          onChange={(e) => setScheduleType(e.target.value as TaskInput["scheduleType"])}
        >
          <option value="daily">每天</option>
          <option value="manual">仅手动</option>
        </select>
        {scheduleType === "daily" && (
          <input
            type="time"
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
            value={dailyTime}
            onChange={(e) => setDailyTime(e.target.value)}
          />
        )}
      </div>

      <label className="mb-3 flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="text-zinc-500">保存后立即启用</span>
      </label>

      <div className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        任务跑起来会自己开一个窗口，跑完自动关。这期间别动那个窗口，也别关电脑或浏览器。
      </div>

      <div className="mt-3 flex gap-2">
        <button
          className="rounded-md bg-zinc-900 px-3 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          disabled={busy || !title.trim() || !prompt.trim()}
          onClick={async () => {
            setBusy(true);
            await onSave({ title, prompt, scheduleType, dailyTime: scheduleType === "daily" ? dailyTime : null, enabled });
            setBusy(false);
          }}
        >
          保存
        </button>
        <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Task["status"] }) {
  const map = {
    running: ["运行中", "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"],
    scheduled: ["已启用", "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"],
    idle: ["仅手动", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"],
    paused: ["已暂停", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{label}</span>;
}

function IconButton({
  children, title, onClick, disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
