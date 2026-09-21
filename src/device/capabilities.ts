/**
 * 这台设备能干哪些平台的活。
 *
 * 服务端派活时按 `requiredCapability` 过滤设备（execution-tasks.service.ts 的 claim），
 * 所以这份列表不报上去，带平台要求的工单就永远轮不到这台机器。
 *
 * **以用户勾选为准，探测只是帮忙填。** 自动探测靠 cookie 判断登录，
 * 但 cookie 在不在跟「能不能真的干活」不是一回事（会过期、会被平台踢），
 * 所以探测结果只作为勾选的建议，最终听用户的。
 */
import { PLATFORMS, findPlatform } from "./platforms";
import { supportedTypes } from "./jobs";

const CAPABILITIES_KEY = "DeviceCapabilities";

/** 只保留平台表里认识的 id，去重后排序，保证上报的内容稳定可比 */
function normalize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    if (!findPlatform(item)) continue;
    seen.add(item);
  }
  return [...seen].sort();
}

/** 用户勾了哪些平台。界面读这个，别读 reportedCapabilities */
export async function loadCapabilities(): Promise<string[]> {
  const stored = await chrome.storage.local.get(CAPABILITIES_KEY);
  return normalize(stored[CAPABILITIES_KEY]);
}

/**
 * 真正上报给服务端的那份：用户勾的平台 + 这个插件版本会干的工单类型（前缀 `job:`）。
 *
 * 为什么把工单类型也算进能力：服务端建 auto 工单前会检查「名下有没有机器会干这活」。
 * 只报平台的话，服务端只知道这台机器登录着小红书，不知道插件实现没实现发布——
 * 于是工单建出来、派下来、插件回一句「不会干」、重试到用尽变 failed，
 * 中间几分钟网页上看着一切正常。带上 job: 之后这种工单在建单时就被挡掉了。
 *
 * 插件升级后多实现一类工单，下一次心跳就自动把新能力带上去，不用用户做什么。
 */
export async function reportedCapabilities(): Promise<string[]> {
  const platforms = await loadCapabilities();
  return [...platforms, ...supportedTypes().map((type) => `job:${type}`)];
}

export async function saveCapabilities(list: string[]): Promise<string[]> {
  const next = normalize(list);
  await chrome.storage.local.set({ [CAPABILITIES_KEY]: next });
  return next;
}

/** 有没有 cookies 权限。没有的话探测不了，界面上要给按钮去申请 */
export async function hasCookiesPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ["cookies"] });
  } catch {
    return false;
  }
}

export interface DetectedPlatform {
  id: string;
  name: string;
  loggedIn: boolean;
}

/**
 * 按 cookie 探测每个平台的登录状态。
 *
 * 需要 cookies 权限（manifest 里是 optional_permissions，得用户点一下才有）。
 * 没权限时抛错而不是返回空列表——返回空会被当成「都没登录」，让用户以为探测过了。
 */
export async function detectPlatforms(): Promise<DetectedPlatform[]> {
  if (!(await hasCookiesPermission())) {
    throw new Error("还没有读取 Cookie 的权限，先点「允许探测」");
  }

  return Promise.all(
    PLATFORMS.map(async (platform) => {
      let loggedIn = false;
      for (const name of platform.loginCookies.names) {
        try {
          const cookie = await chrome.cookies.get({ url: platform.loginCookies.url, name });
          if (cookie?.value) {
            loggedIn = true;
            break;
          }
        } catch {
          /* 单个 cookie 读失败不影响其它平台的判断 */
        }
      }
      return { id: platform.id, name: platform.name, loggedIn };
    }),
  );
}

/** 探测一轮并把登录着的平台并进已勾选的列表；不删用户手动勾的 */
export async function detectAndMerge(): Promise<{ capabilities: string[]; detected: DetectedPlatform[] }> {
  const detected = await detectPlatforms();
  const current = await loadCapabilities();
  const merged = await saveCapabilities([
    ...current,
    ...detected.filter((d) => d.loggedIn).map((d) => d.id),
  ]);
  return { capabilities: merged, detected };
}
