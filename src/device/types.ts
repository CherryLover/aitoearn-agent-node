/**
 * 执行端（设备）这条线的数据结构。
 *
 * 术语跟服务端对齐：
 * - 设备：这台浏览器，配对一次拿一个长期令牌
 * - 工单：服务端派下来的一件活，领取时给一个租约
 * - 租约：这个活在一段时间内归我，续租、上报、回报都要带 leaseId
 */

export interface DeviceAccountInfo {
  platform: string;
  accountName?: string;
  accountId?: string;
}

export interface DeviceState {
  id: string | null;
  name: string | null;
  /** 设备令牌明文。只在配对时拿得到一次，丢了只能重新配对 */
  token: string | null;
  pairedAt: number;
  /** 服务端建议的心跳间隔（秒），不要自己写死 */
  heartbeatSeconds: number;
  /** 最后一次心跳成功的本地时间 */
  lastHeartbeatAt: number;
  /** 最后一次心跳失败的原因；成功一次就清掉 */
  lastHeartbeatError: string | null;
  /** 最后一次去领活的时间，不管领没领到 */
  lastClaimAt: number;
  /** 最后一次领活失败的原因；成功一次就清掉 */
  lastClaimError: string | null;
  /** 令牌失效或设备被吊销：停掉一切请求，等用户重新配对 */
  revoked: boolean;
  revokedReason: string | null;
  capabilities: string[];
  accounts: DeviceAccountInfo[];
}

export const EMPTY_DEVICE: DeviceState = {
  id: null,
  name: null,
  token: null,
  pairedAt: 0,
  heartbeatSeconds: 30,
  lastHeartbeatAt: 0,
  lastHeartbeatError: null,
  lastClaimAt: 0,
  lastClaimError: null,
  revoked: false,
  revokedReason: null,
  capabilities: [],
  accounts: [],
};

/** 领到的工单。leaseId 只在领取时给这一次 */
export interface ClaimedTask {
  id: string;
  type: string;
  projectId: string;
  payload: Record<string, unknown>;
  leaseId: string;
  /** 租约到期时间（本地毫秒） */
  leaseExpiresAt: number;
  attempts: number;
  maxAttempts: number;
}

/**
 * 干过的活，只在本地留一份给人看。
 * dropped = 租约已经不是我们的了，活丢掉，没有回报（回报也会被拒）
 */
export type JobOutcome = "running" | "success" | "failed" | "dropped";

export interface JobRecord {
  taskId: string;
  type: string;
  startedAt: number;
  finishedAt: number | null;
  outcome: JobOutcome;
  /** 一行摘要，成功时是结果，失败时是原因 */
  summary: string | null;
  error: string | null;
}

/** 给界面看的设备状态。令牌不往界面送，界面只需要知道有没有 */
export type DeviceView = Omit<DeviceState, "token"> & { hasToken: boolean };

/** 给侧边栏看的整份状态 */
export interface DeviceSnapshot {
  device: DeviceView;
  jobs: JobRecord[];
  /** 正在干活 */
  busy: boolean;
  /** 按最后心跳时间本地算的在线状态，跟服务端判定口径一致（3 倍心跳间隔） */
  online: boolean;
  apiBase: string;
  homeUrl: string;
  /** 这台机器声明能干哪些平台的活，上报给服务端做派活过滤 */
  capabilities: string[];
  /** 插件这个版本认识的平台，界面拿来画勾选框 */
  knownPlatforms: { id: string; name: string; entryUrl: string }[];
  /** 插件这个版本会干的工单类型，界面上如实显示，别让人以为什么都能干 */
  supportedJobTypes: string[];
  /** 有没有 cookies 权限，没有就不能自动探测登录状态 */
  canDetect: boolean;
}

export interface PairInput {
  code: string;
  name: string;
}
