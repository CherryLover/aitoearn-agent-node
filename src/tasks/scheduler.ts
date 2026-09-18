/**
 * 每日定时调度。
 *
 * 每个「启用 + 每日 + 有时间」的任务挂一个一次性闹钟，名字是 task_alarm:<任务 id>，
 * 触发后跑一次再排下一个。没有用周期闹钟，因为每天的执行时刻要按本地时区重新算。
 *
 * 注意：**监听器必须在 Service Worker 脚本顶层同步注册**（见 background/index.ts）。
 * 浏览器休眠、被闹钟唤醒时，Chrome 可能在监听器装上之前就把事件派发完了，
 * 那一次定时就被静默跳过。
 */
import { loadTasks, getTask, computeNextRunAt, patchTask } from "./store";
import { enqueueRun } from "./runner";

export const TASK_ALARM_PREFIX = "task_alarm:";

/** 顶层就挂上，函数体里的异步逻辑再慢慢跑 */
export function handleTaskAlarm(alarm: chrome.alarms.Alarm): void {
  if (!alarm.name.startsWith(TASK_ALARM_PREFIX)) return;
  const taskId = alarm.name.slice(TASK_ALARM_PREFIX.length);
  void (async () => {
    const task = await getTask(taskId);
    // 到点了再校验一次：任务还在、还启用、还是每日
    if (!task || !task.enabled || task.scheduleType !== "daily" || !task.dailyTime) {
      return;
    }
    await enqueueRun(taskId, "scheduled");
    // 不等这次跑完就排下一个闹钟。等整次运行结束再排的话，
    // 任务跑一小时，明天那次就被推迟一小时
    await syncTaskAlarm(taskId);
  })();
}

/** 给一个任务排闹钟；不该排的就清掉 */
export async function syncTaskAlarm(taskId: string): Promise<void> {
  const name = TASK_ALARM_PREFIX + taskId;
  await chrome.alarms.clear(name);
  const task = await getTask(taskId);
  if (!task || !task.enabled || task.scheduleType !== "daily" || !task.dailyTime) return;
  const when = computeNextRunAt(task.scheduleType, task.dailyTime);
  if (!when) return;
  chrome.alarms.create(name, { when });
  await patchTask(taskId, { nextRunAt: when });
}

/** Service Worker 每次启动都重建一遍闹钟 */
export async function rebuildAllAlarms(): Promise<void> {
  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name.startsWith(TASK_ALARM_PREFIX)) await chrome.alarms.clear(alarm.name);
  }
  for (const task of await loadTasks()) {
    await syncTaskAlarm(task.id);
  }
}

/** 调试用：看看现在挂着哪些闹钟 */
export async function listTaskAlarms(): Promise<Array<{ taskId: string; when: number }>> {
  const alarms = await chrome.alarms.getAll();
  return alarms
    .filter((a) => a.name.startsWith(TASK_ALARM_PREFIX))
    .map((a) => ({ taskId: a.name.slice(TASK_ALARM_PREFIX.length), when: a.scheduledTime }));
}
