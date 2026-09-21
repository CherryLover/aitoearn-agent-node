/**
 * 设备接口客户端。
 *
 * 后端这套接口出错时 HTTP 仍然是 200，错误在 body 的 code 字段里，
 * 所以每一次请求都要把信封拆开看 code，不能只看 HTTP 状态。
 */
import { loadServerConfig } from "@/shared/config";
import { loadDevice } from "./store";
import type { ClaimedTask, DeviceAccountInfo, DeviceState, PairInput } from "./types";

/** 服务端错误码，只列插件要分情况处理的那些 */
export const CODE = {
  /** 配对码无效或过期 */
  PAIRING_CODE_INVALID: 20300,
  /** 配对码已经用过了 */
  PAIRING_CODE_USED: 20301,
  /** 设备令牌无效 */
  TOKEN_INVALID: 20304,
  /** 请求没带令牌 */
  TOKEN_MISSING: 20305,
  /** 设备已吊销 */
  REVOKED: 20306,
  /** 租约对不上 */
  LEASE_INVALID: 20401,
  /** 租约已过期 */
  LEASE_EXPIRED: 20402,
  /** 工单状态不允许这个操作（已取消或已完结） */
  TASK_STATUS_INVALID: 20403,
} as const;

/** 这几个码意味着「这个活已经不归我了」：直接丢掉，绝不重试 */
export function isLeaseLost(code: number): boolean {
  return (
    code === CODE.LEASE_INVALID || code === CODE.LEASE_EXPIRED || code === CODE.TASK_STATUS_INVALID
  );
}

/** 这几个码意味着「这台设备的身份没了」：停掉一切请求，等用户重新配对 */
export function isIdentityLost(code: number): boolean {
  return code === CODE.TOKEN_INVALID || code === CODE.TOKEN_MISSING || code === CODE.REVOKED;
}

export class DeviceApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "DeviceApiError";
  }
}

/** 网络层出错（连不上、超时），跟业务错误分开，因为处理方式不一样：这个可以重试 */
export class DeviceNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceNetworkError";
  }
}

interface RequestOptions {
  /** 配对接口不需要令牌 */
  anonymous?: boolean;
}

async function post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const { apiBase } = await loadServerConfig();
  const headers = new Headers({ "Content-Type": "application/json" });

  if (!options.anonymous) {
    const { token } = await loadDevice();
    if (!token) throw new DeviceApiError(CODE.TOKEN_MISSING, "这台设备还没有配对");
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    throw new DeviceNetworkError(
      `连不上 ${apiBase}：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await response.text();
  let envelope: { data?: unknown; code?: number; message?: string } | null = null;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new DeviceNetworkError(
      `${path} 返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`,
    );
  }

  const code = envelope?.code ?? 0;
  if (code !== 0 && code !== 200) {
    throw new DeviceApiError(code, envelope?.message || `请求失败（code ${code}）`);
  }
  if (!response.ok) {
    throw new DeviceNetworkError(`${path} 失败：HTTP ${response.status}`);
  }
  return envelope?.data as T;
}

// ---- 设备自己的信息：每次配对和心跳都带上 ----

export function currentVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

export function currentPlatform(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("CrOS")) return "ChromeOS";
  if (ua.includes("Linux")) return "Linux";
  return "Unknown";
}

// ---- 接口 ----

interface PairedResponse {
  device: { id: string; name: string };
  token: string;
}

/**
 * 拿配对码换设备令牌。
 * 令牌明文只在这里返回一次，调用方必须负责存起来。
 */
export async function pairDevice(
  input: PairInput,
  capabilities: string[] = [],
): Promise<PairedResponse> {
  return post<PairedResponse>(
    "/device-api/pair",
    {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      version: currentVersion(),
      platform: currentPlatform(),
      capabilities,
      accounts: [],
    },
    { anonymous: true },
  );
}

interface HeartbeatResponse {
  deviceId: string;
  serverTime: string;
  heartbeatSeconds: number;
}

export async function sendHeartbeat(
  status: "idle" | "busy",
  extra?: { capabilities?: string[]; accounts?: DeviceAccountInfo[] },
): Promise<HeartbeatResponse> {
  return post<HeartbeatResponse>("/device-api/heartbeat", {
    status,
    version: currentVersion(),
    platform: currentPlatform(),
    ...extra,
  });
}

interface ClaimResponse {
  task: {
    id: string;
    type: string;
    projectId: string;
    payload: Record<string, unknown>;
    leaseId: string;
    leaseExpiresAt: string;
    attempts: number;
    maxAttempts: number;
  } | null;
}

/** 领一个活。没活时返回 null，**这不是错误**，别退避别重试 */
export async function claimTask(): Promise<ClaimedTask | null> {
  const data = await post<ClaimResponse>("/device-api/tasks/claim", {});
  const task = data?.task;
  if (!task) return null;
  return { ...task, leaseExpiresAt: new Date(task.leaseExpiresAt).getTime() };
}

interface LeaseResponse {
  id: string;
  status: string;
  leaseExpiresAt: string;
}

export async function startTask(taskId: string, leaseId: string): Promise<number> {
  const data = await post<LeaseResponse>(`/device-api/tasks/${taskId}/start`, { leaseId });
  return new Date(data.leaseExpiresAt).getTime();
}

export async function renewTask(taskId: string, leaseId: string): Promise<number> {
  const data = await post<LeaseResponse>(`/device-api/tasks/${taskId}/renew`, { leaseId });
  return new Date(data.leaseExpiresAt).getTime();
}

export interface ReportInput {
  leaseId: string;
  success: boolean;
  result?: Record<string, unknown>;
  /** 失败原因会显示给用户看，写人话 */
  error?: string;
}

export async function reportTask(taskId: string, input: ReportInput): Promise<void> {
  await post(`/device-api/tasks/${taskId}/report`, input);
}

/** 拿到身份类错误时，把设备标成吊销，后面所有定时活动都会自己停下来 */
export function revokedPatch(err: DeviceApiError): Partial<DeviceState> {
  return {
    revoked: true,
    // 网页上「吊销」之后，令牌直接查不到了，服务端回的是 20304 而不是 20306，
    // 所以这句话要把「被移除」也说进去，不然用户看不懂自己刚干了什么
    revokedReason:
      err.code === CODE.REVOKED
        ? "这台设备已在网页上被移除，重新配对一次"
        : "设备令牌失效了（多半是在网页上被移除了），重新配对一次",
  };
}
