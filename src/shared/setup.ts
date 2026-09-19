/**
 * 开箱检查：插件打开时先确认「能不能用」，不能用就把人引到配置上去。
 *
 * 检查三件事，都不花钱：
 *   1. 服务器地址通不通，而且确实是个 AiToEarn 后端（拉模型列表，这个接口不要凭证）
 *   2. 凭证在不在、过没过期（本地解 JWT，不发请求）
 *   3. 后端至少给出一个可用模型
 *
 * 故意不去 POST 一次模型请求来验证凭证——那会真的扣积分。
 * 凭证对不对但不是这台服务器签发的，这种情况留给第一次实际调用时报错。
 */
import { loadServerConfig } from "./config";
import { loadAuth } from "./auth";
import { fetchChatModels } from "@/agent/models";
import { loadDevice } from "@/device/store";

export interface CheckItem {
  ok: boolean;
  message: string;
}

export interface SetupStatus {
  server: CheckItem;
  auth: CheckItem & { userName?: string; expiresAt?: number };
  model: CheckItem & { count: number };
  ready: boolean;
  /**
   * 这台机器配过对没有。
   * 配对不需要网页登录凭证，所以配过对的执行端机器不该再被凭证这一步卡住。
   */
  devicePaired: boolean;
  apiBase: string;
  homeUrl: string;
}

interface JwtPayload {
  exp?: number;
  name?: string;
  mail?: string;
}

/** 本地解 JWT 的 payload；不是 JWT 或解不开就返回 null */
function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(""),
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

export async function checkSetup(): Promise<SetupStatus> {
  const { apiBase, homeUrl } = await loadServerConfig();

  const server: CheckItem = { ok: false, message: "" };
  const model: SetupStatus["model"] = { ok: false, message: "", count: 0 };
  let models: Awaited<ReturnType<typeof fetchChatModels>> = [];

  try {
    models = await fetchChatModels();
    server.ok = true;
    server.message = `已连上 ${new URL(apiBase).host}`;
  } catch (err) {
    server.message = err instanceof Error ? err.message : String(err);
    if (/Failed to fetch|NetworkError|ERR_/.test(server.message)) {
      server.message = `连不上 ${apiBase}，检查地址对不对、服务器在不在`;
    }
  }

  if (server.ok) {
    model.count = models.length;
    model.ok = models.length > 0;
    model.message = models.length > 0 ? `${models.length} 个可用模型` : "后端没有返回任何可用模型";
  } else {
    model.message = "等服务器连通后再查";
  }

  const auth: SetupStatus["auth"] = { ok: false, message: "" };
  const { token, userName } = await loadAuth();
  if (!token) {
    auth.message = "还没有凭证";
  } else {
    const payload = decodeJwt(token);
    if (!payload) {
      auth.message = "凭证格式不对，重新同步一次";
    } else if (payload.exp && payload.exp * 1000 <= Date.now()) {
      auth.message = `凭证已于 ${formatDate(payload.exp * 1000)} 过期，重新同步一次`;
      auth.expiresAt = payload.exp * 1000;
    } else {
      auth.ok = true;
      auth.userName = userName ?? payload.name ?? payload.mail ?? undefined;
      auth.expiresAt = payload.exp ? payload.exp * 1000 : undefined;
      auth.message = auth.expiresAt
        ? `${auth.userName ?? "已登录"}，${formatDate(auth.expiresAt)} 到期`
        : (auth.userName ?? "已登录");
    }
  }

  const { token: deviceToken } = await loadDevice();

  return {
    server,
    auth,
    model,
    ready: server.ok && auth.ok && model.ok,
    devicePaired: Boolean(deviceToken),
    apiBase,
    homeUrl,
  };
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
