/**
 * 设备状态与干活记录的存储。
 *
 * 设备令牌跟网页登录凭证（shared/auth.ts）分开存：
 * 一个是这台机器的长期身份，一个是用户的登录态，失效条件和补救办法都不一样。
 */
import { EMPTY_DEVICE, type DeviceState, type JobRecord } from "./types";

const DEVICE_KEY = "Device";
const JOBS_KEY = "DeviceJobs";
/** 本地最多留这么多条干活记录 */
const MAX_JOBS = 30;

export async function loadDevice(): Promise<DeviceState> {
  const stored = await chrome.storage.local.get(DEVICE_KEY);
  const value = stored[DEVICE_KEY] as Partial<DeviceState> | undefined;
  if (!value || typeof value.token !== "string") return { ...EMPTY_DEVICE };
  return { ...EMPTY_DEVICE, ...value };
}

export async function saveDevice(state: DeviceState): Promise<DeviceState> {
  await chrome.storage.local.set({ [DEVICE_KEY]: state });
  return state;
}

export async function patchDevice(patch: Partial<DeviceState>): Promise<DeviceState> {
  const current = await loadDevice();
  return saveDevice({ ...current, ...patch });
}

export async function clearDevice(): Promise<DeviceState> {
  await chrome.storage.local.remove(DEVICE_KEY);
  return { ...EMPTY_DEVICE };
}

export async function loadJobs(): Promise<JobRecord[]> {
  const stored = await chrome.storage.local.get(JOBS_KEY);
  const list = stored[JOBS_KEY];
  return Array.isArray(list) ? (list as JobRecord[]) : [];
}

export async function addJob(job: JobRecord): Promise<void> {
  const jobs = await loadJobs();
  await chrome.storage.local.set({ [JOBS_KEY]: [job, ...jobs].slice(0, MAX_JOBS) });
}

export async function patchJob(taskId: string, patch: Partial<JobRecord>): Promise<void> {
  const jobs = await loadJobs();
  const idx = jobs.findIndex((j) => j.taskId === taskId);
  if (idx < 0) return;
  jobs[idx] = { ...jobs[idx], ...patch };
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
}

export async function clearJobs(): Promise<void> {
  await chrome.storage.local.remove(JOBS_KEY);
}

/**
 * 在线判定跟服务端一个口径：最后心跳在 3 倍心跳间隔之内算在线。
 * 不看有没有连着 WebSocket——浏览器休眠时连接会悄悄断掉，但设备其实还在。
 */
export function isOnline(device: DeviceState, now = Date.now()): boolean {
  if (!device.token || device.revoked || !device.lastHeartbeatAt) return false;
  return now - device.lastHeartbeatAt <= device.heartbeatSeconds * 3 * 1000;
}
