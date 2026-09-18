/**
 * 任务与运行记录的存储。
 *
 * 直接用 chrome.storage.local 读写，写入集中在这几个函数里，运行记录有条数上限，
 * 免得跑久了把存储撑爆。
 */
import type { Task, TaskInput, TaskRun, TaskStatus } from "./types";

const TASKS_KEY = "Tasks";
const RUNS_KEY = "TaskRuns";
/** 每个任务最多留这么多条运行记录 */
const MAX_RUNS_PER_TASK = 20;

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

/** "9:5" → "09:05"；格式不对或越界返回 null */
export function normalizeDailyTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * 下一次每日运行的时间戳。用运行这台机器的本地时区，
 * task.timezone 只是记录下来给人看的。今天这个点已经过了就顺延到明天。
 */
export function computeNextRunAt(
  scheduleType: Task["scheduleType"],
  dailyTime: string | null,
  now = Date.now(),
): number | null {
  if (scheduleType !== "daily") return null;
  const normalized = normalizeDailyTime(dailyTime);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function idleStatus(enabled: boolean, scheduleType: Task["scheduleType"]): TaskStatus {
  if (!enabled) return "paused";
  return scheduleType === "daily" ? "scheduled" : "idle";
}

export async function loadTasks(): Promise<Task[]> {
  const stored = await chrome.storage.local.get(TASKS_KEY);
  const list = stored[TASKS_KEY];
  return Array.isArray(list) ? (list as Task[]) : [];
}

async function writeTasks(tasks: Task[]): Promise<void> {
  await chrome.storage.local.set({ [TASKS_KEY]: tasks });
}

export async function loadRuns(): Promise<Record<string, TaskRun[]>> {
  const stored = await chrome.storage.local.get(RUNS_KEY);
  const map = stored[RUNS_KEY];
  return map && typeof map === "object" ? (map as Record<string, TaskRun[]>) : {};
}

async function writeRuns(runs: Record<string, TaskRun[]>): Promise<void> {
  await chrome.storage.local.set({ [RUNS_KEY]: runs });
}

function normalizeInput(input: TaskInput) {
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  if (!title) throw new Error("任务标题不能为空");
  if (!prompt) throw new Error("任务提示词不能为空");
  const scheduleType = input.scheduleType === "daily" ? "daily" : "manual";
  const dailyTime = scheduleType === "daily" ? normalizeDailyTime(input.dailyTime) : null;
  if (scheduleType === "daily" && !dailyTime) throw new Error("每日任务要填一个有效的时间，格式 HH:mm");
  return { title, prompt, scheduleType, dailyTime, enabled: Boolean(input.enabled) } as const;
}

export async function createTask(input: TaskInput): Promise<Task> {
  const n = normalizeInput(input);
  const now = Date.now();
  const task: Task = {
    id: `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
    ...n,
    timezone: localTimezone(),
    status: idleStatus(n.enabled, n.scheduleType),
    nextRunAt: n.enabled ? computeNextRunAt(n.scheduleType, n.dailyTime, now) : null,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const tasks = await loadTasks();
  await writeTasks([task, ...tasks]);
  return task;
}

export async function updateTask(id: string, input: TaskInput): Promise<Task> {
  const n = normalizeInput(input);
  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) throw new Error("没找到这个任务");
  if (tasks[idx].status === "running") throw new Error("任务运行中，暂时不能编辑");
  const now = Date.now();
  const next: Task = {
    ...tasks[idx],
    ...n,
    status: idleStatus(n.enabled, n.scheduleType),
    nextRunAt: n.enabled ? computeNextRunAt(n.scheduleType, n.dailyTime, now) : null,
    updatedAt: now,
  };
  tasks[idx] = next;
  await writeTasks(tasks);
  return next;
}

export async function deleteTask(id: string): Promise<void> {
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === id);
  if (task?.status === "running") throw new Error("任务运行中，暂时不能删除");
  await writeTasks(tasks.filter((t) => t.id !== id));
  const runs = await loadRuns();
  delete runs[id];
  await writeRuns(runs);
}

export async function setTaskEnabled(id: string, enabled: boolean): Promise<Task> {
  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) throw new Error("没找到这个任务");
  const now = Date.now();
  tasks[idx] = {
    ...tasks[idx],
    enabled,
    status: tasks[idx].status === "running" ? "running" : idleStatus(enabled, tasks[idx].scheduleType),
    nextRunAt: enabled ? computeNextRunAt(tasks[idx].scheduleType, tasks[idx].dailyTime, now) : null,
    updatedAt: now,
  };
  await writeTasks(tasks);
  return tasks[idx];
}

export async function patchTask(id: string, patch: Partial<Task>): Promise<Task | null> {
  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  tasks[idx] = { ...tasks[idx], ...patch };
  await writeTasks(tasks);
  return tasks[idx];
}

export async function getTask(id: string): Promise<Task | null> {
  return (await loadTasks()).find((t) => t.id === id) ?? null;
}

export async function addRun(run: TaskRun): Promise<void> {
  const runs = await loadRuns();
  const list = [run, ...(runs[run.taskId] ?? [])].slice(0, MAX_RUNS_PER_TASK);
  runs[run.taskId] = list;
  await writeRuns(runs);
}

export async function patchRun(taskId: string, runId: string, patch: Partial<TaskRun>): Promise<void> {
  const runs = await loadRuns();
  const list = runs[taskId] ?? [];
  const idx = list.findIndex((r) => r.id === runId);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch };
  runs[taskId] = list;
  await writeRuns(runs);
}

export async function clearRuns(taskId: string): Promise<void> {
  const runs = await loadRuns();
  delete runs[taskId];
  await writeRuns(runs);
}

/**
 * Service Worker 被回收时，正在跑的运行不会有人给它收尾，
 * 下次启动要把这些悬着的记录标成「中断」，不然界面上会一直显示运行中。
 */
export async function markInterruptedRuns(): Promise<number> {
  const runs = await loadRuns();
  let count = 0;
  for (const [taskId, list] of Object.entries(runs)) {
    runs[taskId] = list.map((r) => {
      if (r.status === "running" || r.status === "queued") {
        count += 1;
        return { ...r, status: "interrupted" as const, finishedAt: Date.now(), error: "后台被浏览器回收，运行中断" };
      }
      return r;
    });
  }
  if (count > 0) await writeRuns(runs);

  const tasks = await loadTasks();
  let changed = false;
  const fixed = tasks.map((t) => {
    if (t.status !== "running") return t;
    changed = true;
    return { ...t, status: idleStatus(t.enabled, t.scheduleType) };
  });
  if (changed) await writeTasks(fixed);
  return count;
}
