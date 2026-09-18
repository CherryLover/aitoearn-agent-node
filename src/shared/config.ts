/**
 * 服务器地址配置。
 *
 * 只服务自部署，所以只有一套地址。存在 chrome.storage.local["ServerConfig"]。
 */
export const SERVER_CONFIG_KEY = "ServerConfig";

export interface ServerConfig {
  /** 接口根地址，例如 https://pub.flyooo.uk/api */
  apiBase: string;
  /** 网页根地址，登录、查看任务用 */
  homeUrl: string;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  apiBase: "https://pub.flyooo.uk/api",
  homeUrl: "https://pub.flyooo.uk",
};

function normalize(raw: unknown): ServerConfig {
  const input = (raw ?? {}) as Partial<ServerConfig>;
  const pick = (value: unknown, fallback: string) => {
    if (typeof value !== "string") return fallback;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    } catch {
      return fallback;
    }
    return value.replace(/\/+$/, "");
  };
  return {
    apiBase: pick(input.apiBase, DEFAULT_SERVER_CONFIG.apiBase),
    homeUrl: pick(input.homeUrl, DEFAULT_SERVER_CONFIG.homeUrl),
  };
}

export async function loadServerConfig(): Promise<ServerConfig> {
  const stored = await chrome.storage.local.get(SERVER_CONFIG_KEY);
  return normalize(stored[SERVER_CONFIG_KEY]);
}

export async function saveServerConfig(config: Partial<ServerConfig>): Promise<ServerConfig> {
  const current = await loadServerConfig();
  const next = normalize({ ...current, ...config });
  await chrome.storage.local.set({ [SERVER_CONFIG_KEY]: next });
  return next;
}
