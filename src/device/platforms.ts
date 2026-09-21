/**
 * 平台表：能力标识、创作平台域名白名单、登录探测用的 cookie。
 *
 * **域名白名单是安全边界，不是配置。** 工单载荷里的 entryUrl 来自服务端，
 * host 不在对应平台的白名单里就拒绝执行——否则一个被改过的服务端就能让插件
 * 带着用户的登录态去访问任意站点。这张表只能改代码，不接受远程下发。
 */

export interface PlatformDef {
  /** 能力标识，跟服务端 requiredCapability 对齐 */
  id: string;
  name: string;
  /** 创作平台允许访问的 host，精确匹配，不做后缀匹配 */
  hosts: string[];
  /** 默认入口，界面上「去登录」和本地试跑用 */
  entryUrl: string;
  /** 登录探测：这些 cookie 任意一个存在就认为登录了 */
  loginCookies: { url: string; names: string[] };
}

export const PLATFORMS: PlatformDef[] = [
  {
    id: "xhs",
    name: "小红书",
    hosts: ["creator.xiaohongshu.com"],
    entryUrl: "https://creator.xiaohongshu.com/new/note-manager",
    loginCookies: {
      url: "https://creator.xiaohongshu.com",
      names: ["web_session", "customerClientId", "galaxy_creator_session_id"],
    },
  },
  {
    id: "douyin",
    name: "抖音",
    hosts: ["creator.douyin.com"],
    entryUrl: "https://creator.douyin.com/creator-micro/content/manage",
    loginCookies: { url: "https://creator.douyin.com", names: ["sessionid", "sessionid_ss"] },
  },
  {
    id: "bilibili",
    name: "哔哩哔哩",
    hosts: ["member.bilibili.com"],
    entryUrl: "https://member.bilibili.com/platform/upload-manager/article",
    loginCookies: { url: "https://member.bilibili.com", names: ["SESSDATA"] },
  },
  {
    id: "wechat_channels",
    name: "视频号",
    hosts: ["channels.weixin.qq.com"],
    entryUrl: "https://channels.weixin.qq.com/platform/post/list",
    loginCookies: { url: "https://channels.weixin.qq.com", names: ["sessionid"] },
  },
];

export function findPlatform(id: string): PlatformDef | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

/**
 * 校验工单给的地址是否落在该平台的白名单里。
 * 只认 https，只认精确 host——子域名不放行，免得 `evil.creator.xiaohongshu.com.attacker.tld` 这类混过去。
 */
export function isAllowedEntryUrl(platformId: string, rawUrl: string): boolean {
  const platform = findPlatform(platformId);
  if (!platform) return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return platform.hosts.includes(url.hostname);
}
