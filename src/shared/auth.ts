/**
 * 登录凭证。
 *
 * 目标形态：插件跟服务器配对，拿一份只属于这台机器的凭证，不依赖网页登录。
 * 当前是过渡方案，两种办法拿凭证：手动粘贴，或者从已登录的网页同步过来。
 * 两种都走同一个存储键，以后换成配对凭证时上层代码不用改。
 */
export const AUTH_KEY = "Auth";

export interface AuthState {
  token: string | null;
  /** 凭证是怎么来的，界面上要如实显示 */
  source: "manual" | "web-sync" | null;
  userName: string | null;
  updatedAt: number;
}

const EMPTY: AuthState = { token: null, source: null, userName: null, updatedAt: 0 };

export async function loadAuth(): Promise<AuthState> {
  const stored = await chrome.storage.local.get(AUTH_KEY);
  const value = stored[AUTH_KEY] as Partial<AuthState> | undefined;
  if (!value || typeof value.token !== "string") return EMPTY;
  return {
    token: value.token,
    source: value.source ?? null,
    userName: value.userName ?? null,
    updatedAt: value.updatedAt ?? 0,
  };
}

export async function saveAuth(next: Omit<AuthState, "updatedAt">): Promise<AuthState> {
  const state: AuthState = { ...next, updatedAt: Date.now() };
  await chrome.storage.local.set({ [AUTH_KEY]: state });
  return state;
}

export async function clearAuth(): Promise<AuthState> {
  await chrome.storage.local.remove(AUTH_KEY);
  return EMPTY;
}

/** 给后端请求加上 Bearer 头；没有凭证就原样返回，让后端回 401 */
export async function withAuthHeaders(init?: HeadersInit): Promise<Headers> {
  const headers = new Headers(init);
  const { token } = await loadAuth();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/**
 * 从已登录的 AiToEarn 网页里同步登录态。
 *
 * 网页把登录信息用 zustand 持久化在 localStorage["User"]，
 * 结构是 { state: { token, userInfo } }。
 *
 * 只在「最后聚焦的窗口」里找主页标签页；找不到就新开一个，读完如果是自己开的就关掉。
 */
export async function syncAuthFromWeb(homeUrl: string): Promise<AuthState> {
  const origin = new URL(homeUrl).origin;
  const lastFocused = await chrome.windows.getLastFocused();
  let tabs = await chrome.tabs.query({ url: `${origin}/*`, windowId: lastFocused.id });
  let openedByUs = false;
  let tabId = tabs[0]?.id;

  if (!tabId) {
    const created = await chrome.tabs.create({ url: homeUrl, active: true, windowId: lastFocused.id });
    tabId = created.id!;
    openedByUs = true;
    await waitForTabComplete(tabId, 15000);
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const raw = localStorage.getItem("User");
          if (!raw) return { token: null, userName: null };
          const parsed = JSON.parse(raw);
          return {
            token: parsed?.state?.token ?? null,
            userName: parsed?.state?.userInfo?.name ?? null,
          };
        } catch {
          return { token: null, userName: null };
        }
      },
    });
    const token = result?.result?.token ?? null;
    if (!token) throw new Error(`在 ${origin} 上没读到登录信息，请先在网页里登录再同步。`);
    return await saveAuth({ token, source: "web-sync", userName: result?.result?.userName ?? null });
  } finally {
    if (openedByUs && tabId) await chrome.tabs.remove(tabId).catch(() => {});
  }
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    function onUpdated(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}
