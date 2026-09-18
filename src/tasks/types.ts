export type ScheduleType = "daily" | "manual";

/** 不在运行中时的状态由 enabled + scheduleType 推导，不单独存 */
export type TaskStatus = "paused" | "scheduled" | "idle" | "running";

export interface Task {
  id: string;
  title: string;
  /** 任务提示词：给智能体的那段话 */
  prompt: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  /** "HH:mm"，只有 daily 有 */
  dailyTime: string | null;
  timezone: string;
  status: TaskStatus;
  nextRunAt: number | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type TaskInput = Pick<Task, "title" | "prompt" | "enabled" | "scheduleType" | "dailyTime">;

export type RunStatus = "queued" | "running" | "success" | "failed" | "interrupted" | "stopped";

export interface RunStep {
  at: number;
  kind: "tool" | "text" | "error";
  name?: string;
  status?: "running" | "done" | "error";
  text?: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  trigger: "scheduled" | "manual";
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  steps: RunStep[];
  /** 最终输出，压成一行做摘要 */
  summary: string | null;
  /** 完整的最终输出 */
  output: string | null;
  error: string | null;
}

export interface TaskSnapshot {
  tasks: Task[];
  runs: Record<string, TaskRun[]>;
  /** 正在跑的运行 id；没有就是 null */
  activeRunId: string | null;
  /** 排队中的运行数 */
  queued: number;
}
