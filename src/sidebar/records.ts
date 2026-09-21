/**
 * 执行记录：把云端工单和本地定时任务拉平成同一种东西。
 *
 * 这两者在用户眼里都是「插件替我干的一件活」，区别只是**谁派的**：
 * 一个是服务端派下来的工单，一个是本地定时器到点跑的任务。
 * 分成两个列表会让人每次都要先想「刚才那件事算哪一类」才知道去哪看。
 *
 * 只做纯计算，不碰 chrome.storage，也不订阅任何东西。
 */

import type { JobDetail } from "@/device/job-detail";
import type { JobRecord } from "@/device/types";
import type { Task, TaskRun } from "@/tasks/types";

export type RecordSource = "cloud" | "local";

/** 四种收尾状态，两条线合并到同一套口径上 */
export type RecordOutcome = "running" | "success" | "failed" | "dropped";

export interface ExecutionRecord {
  /** 列表里的唯一键，两条线的 id 可能撞，带上来源前缀 */
  key: string;
  source: RecordSource;
  /** 云端是工单类型，本地是任务标题 */
  title: string;
  outcome: RecordOutcome;
  startedAt: number;
  finishedAt: number | null;
  /** 列表上那一行说明，压成一行 */
  summary: string | null;
  error: string | null;
  /** 这次要它干的事：云端是工单载荷，本地是提示词 */
  input: JobDetail | null;
  /** 干完之后交出去的东西：云端是回报内容，本地是最终输出 */
  output: JobDetail | null;
  /** 详情里那几行灰字 */
  facts: { label: string; value: string }[];
}

const LOCAL_OUTCOME: Record<TaskRun["status"], RecordOutcome> = {
  queued: "running",
  running: "running",
  success: "success",
  failed: "failed",
  interrupted: "dropped",
  stopped: "dropped",
};

export function toCloudRecord(job: JobRecord): ExecutionRecord {
  return {
    key: `cloud_${job.taskId}_${job.startedAt}`,
    source: "cloud",
    title: job.type,
    outcome: job.outcome,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    summary: job.summary,
    error: job.error,
    // 这个版本之前存下来的工单记录没有这两个字段，读出来是 undefined
    input: job.payload ?? null,
    output: job.reported ?? null,
    facts: [{ label: "工单 ID", value: job.taskId }],
  };
}

export function toLocalRecord(run: TaskRun, task: Task | undefined): ExecutionRecord {
  const steps = run.steps
    .map((step) => {
      const name = step.name ? `${step.name} ` : "";
      return `${name}${step.text ?? ""}`.trim();
    })
    .filter(Boolean);

  return {
    key: `local_${run.id}`,
    source: "local",
    // 任务被删掉之后它跑过的记录还在，这时候只剩 id 可显示
    title: task?.title ?? `已删除的任务 ${run.taskId}`,
    outcome: LOCAL_OUTCOME[run.status],
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    error: run.error,
    input: task ? { text: task.prompt, truncated: false } : null,
    output: run.output ? { text: run.output, truncated: false } : null,
    facts: [
      { label: "触发", value: run.trigger === "scheduled" ? "到点自动跑" : "手动跑" },
      ...(steps.length > 0 ? [{ label: "步骤", value: `${steps.length} 步` }] : []),
    ],
  };
}

/** 两条线合起来按开始时间倒序，最近干的排最上面 */
export function mergeRecords(
  jobs: JobRecord[],
  runs: Record<string, TaskRun[]>,
  tasks: Task[],
): ExecutionRecord[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const merged: ExecutionRecord[] = [
    ...jobs.map(toCloudRecord),
    ...Object.values(runs)
      .flat()
      .map((run) => toLocalRecord(run, taskById.get(run.taskId))),
  ];

  return merged.sort((left, right) => right.startedAt - left.startedAt);
}
