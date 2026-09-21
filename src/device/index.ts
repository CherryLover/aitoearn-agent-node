/**
 * 执行端运行时：配对、心跳、定时领活。
 *
 * 两条腿，主次分明：
 * - **定时闹钟是主力**：醒来发一次心跳、去领一次活。这条断了才真出问题。
 * - WebSocket 催办（还没做）只是提速，断了不影响正确性。
 *
 * 在线状态是服务端按心跳算的，所以心跳不能停——浏览器休眠时连接会断，但设备还在。
 */
import { getRuntimeState } from "@/tasks/runner";
import {
  CODE,
  DeviceApiError,
  currentPlatform,
  isIdentityLost,
  pairDevice,
  revokedPatch,
  sendHeartbeat,
} from "./api";
import { notifyDeviceChanged } from "./events";
import { clearDevice, clearJobs, isOnline, loadDevice, loadJobs, patchDevice, saveDevice } from "./store";
import { EMPTY_DEVICE, type DeviceSnapshot, type DeviceState, type PairInput } from "./types";
import { isBusy, pump } from "./worker";
import { loadServerConfig } from "@/shared/config";
import {
  detectAndMerge,
  hasCookiesPermission,
  loadCapabilities,
  saveCapabilities,
  type DetectedPlatform,
} from "./capabilities";
import { PLATFORMS } from "./platforms";
import { supportedTypes } from "./jobs";

export const HEARTBEAT_ALARM = "device:heartbeat";
export const CLAIM_ALARM = "device:claim";

/** 定时领活的间隔（分钟）。这是兜底节奏，以后 WebSocket 催办会让它显得没那么重要 */
const CLAIM_PERIOD_MINUTES = 1;
/** 闹钟最短就是 30 秒，心跳再频繁也没用 */
const MIN_HEARTBEAT_SECONDS = 30;
/** 心跳间隔上限，防止服务端给个离谱的值把设备判成一直离线 */
const MAX_HEARTBEAT_SECONDS = 900;

function clampHeartbeat(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return MIN_HEARTBEAT_SECONDS;
  return Math.min(Math.max(Math.round(seconds), MIN_HEARTBEAT_SECONDS), MAX_HEARTBEAT_SECONDS);
}

export function defaultDeviceName(): string {
  return `${currentPlatform()} 上的 Chrome`;
}

/** 顶层同步注册的闹钟监听器会把设备的闹钟转到这里 */
export function handleDeviceAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name === HEARTBEAT_ALARM) {
    void heartbeatNow();
    return;
  }
  if (alarm.name === CLAIM_ALARM) {
    void pump();
  }
}

/**
 * 按当前配对状态排闹钟；没配对或被吊销就全清掉。
 *
 * 已经排好、间隔也没变的闹钟原样留着，不重建：
 * Service Worker 每次被唤醒都会走一遍这里，每次重建的话下一次触发时间就被一直往后推，
 * 极端情况下永远轮不到领活。
 */
export async function syncDeviceAlarms(): Promise<void> {
  const device = await loadDevice();
  const active = Boolean(device.token) && !device.revoked;

  if (!active) {
    await chrome.alarms.clear(HEARTBEAT_ALARM);
    await chrome.alarms.clear(CLAIM_ALARM);
    return;
  }

  await ensureAlarm(HEARTBEAT_ALARM, clampHeartbeat(device.heartbeatSeconds) / 60);
  await ensureAlarm(CLAIM_ALARM, CLAIM_PERIOD_MINUTES);
}

async function ensureAlarm(name: string, periodInMinutes: number): Promise<void> {
  const existing = await chrome.alarms.get(name);
  if (existing && existing.periodInMinutes === periodInMinutes) return;
  await chrome.alarms.clear(name);
  chrome.alarms.create(name, { periodInMinutes, delayInMinutes: periodInMinutes });
}

/** 配对码换令牌。服务端的错误码翻成人话，用户才知道下一步该干嘛 */
export async function pair(input: PairInput): Promise<DeviceState> {
  const code = input.code.trim();
  if (!code) throw new Error("先填配对码");
  const name = input.name.trim() || defaultDeviceName();

  let paired: Awaited<ReturnType<typeof pairDevice>>;
  try {
    paired = await pairDevice({ code, name }, await loadCapabilities());
  } catch (err) {
    if (err instanceof DeviceApiError) {
      if (err.code === CODE.PAIRING_CODE_INVALID)
        throw new Error("配对码不对或者已经过期了，回网页重新生成一个");
      if (err.code === CODE.PAIRING_CODE_USED)
        throw new Error("这个配对码已经用过了，回网页重新生成一个");
    }
    throw err;
  }

  await saveDevice({
    ...EMPTY_DEVICE,
    id: paired.device.id,
    name: paired.device.name,
    token: paired.token,
    pairedAt: Date.now(),
  });

  await syncDeviceAlarms();
  // 立刻上线，别让用户盯着网页等第一个闹钟
  await heartbeatNow();
  // 顺手看一眼有没有活在等着
  void pump();
  return loadDevice();
}

/**
 * 解除配对：只清掉本地令牌。
 * 服务端那条设备记录还在，要彻底移除得去网页上删。
 */
export async function unpair(): Promise<DeviceState> {
  const state = await clearDevice();
  await syncDeviceAlarms();
  notifyDeviceChanged();
  return state;
}

export async function heartbeatNow(): Promise<DeviceState> {
  const device = await loadDevice();
  if (!device.token || device.revoked) return device;

  const status = isBusy() || getRuntimeState().activeRunId ? "busy" : "idle";

  try {
    // 每次心跳都整份带上能力：服务端是整份覆盖，漏发一次这台机器就变成「什么都不会」
    const res = await sendHeartbeat(status, { capabilities: await loadCapabilities() });
    const next = await patchDevice({
      id: res.deviceId || device.id,
      lastHeartbeatAt: Date.now(),
      lastHeartbeatError: null,
      heartbeatSeconds: clampHeartbeat(res.heartbeatSeconds),
    });
    // 服务端改了建议间隔就重排闹钟，按它给的来
    if (next.heartbeatSeconds !== device.heartbeatSeconds) await syncDeviceAlarms();
    notifyDeviceChanged();
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const patch = err instanceof DeviceApiError && isIdentityLost(err.code) ? revokedPatch(err) : {};
    const next = await patchDevice({ ...patch, lastHeartbeatError: message });
    if (next.revoked) await syncDeviceAlarms();
    notifyDeviceChanged();
    return next;
  }
}

/**
 * 改这台机器能干的平台。
 *
 * 存完立刻补一次心跳，不等下一个闹钟：服务端是按心跳整份覆盖能力的，
 * 用户刚勾完就去网页下单，得马上能派得下来。
 */
export async function setCapabilities(list: string[]): Promise<string[]> {
  const next = await saveCapabilities(list);
  await heartbeatNow();
  notifyDeviceChanged();
  return next;
}

/** 探测已登录的平台并并入勾选，同样立刻补一次心跳 */
export async function detectCapabilities(): Promise<{ capabilities: string[]; detected: DetectedPlatform[] }> {
  const result = await detectAndMerge();
  await heartbeatNow();
  notifyDeviceChanged();
  return result;
}

export async function snapshot(): Promise<DeviceSnapshot> {
  const [device, jobs, config, capabilities, canDetect] = await Promise.all([
    loadDevice(),
    loadJobs(),
    loadServerConfig(),
    loadCapabilities(),
    hasCookiesPermission(),
  ]);
  const { token, ...rest } = device;
  return {
    device: { ...rest, hasToken: Boolean(token) },
    jobs,
    busy: isBusy(),
    online: isOnline(device),
    apiBase: config.apiBase,
    homeUrl: config.homeUrl,
    capabilities,
    knownPlatforms: PLATFORMS.map((p) => ({ id: p.id, name: p.name, entryUrl: p.entryUrl })),
    supportedJobTypes: supportedTypes(),
    canDetect,
  };
}

export async function clearJobHistory(): Promise<void> {
  await clearJobs();
  notifyDeviceChanged();
}

/** Service Worker 每次启动都重建一遍设备的闹钟，顺带补一次心跳 */
export async function bootstrapDevice(): Promise<void> {
  await syncDeviceAlarms();
  const device = await loadDevice();
  if (!device.token || device.revoked) return;
  await heartbeatNow();
  void pump();
}

export { pump } from "./worker";
