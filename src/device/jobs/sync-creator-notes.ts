/**
 * `sync_creator_notes`：把一个创作平台账号的作品列表整张读回来。
 *
 * 为什么不是骨架契约里的 `collect_metrics`（按帖子逐条采）：实测小红书的作品卡片
 * 没有帖子 ID、没有链接、卡片本身不可点，没有可寻址的单帖入口；而列表页一次就能
 * 拿到全部。所以改成「一个工单 = 一个平台 + 一个账号 = 读回整张列表」。
 *
 * 三条硬规矩，全部来自实测（见 docs/rebuild/contract-collect-xhs.md）：
 *
 * 1. **按图标认指标，绝不按位置认。** 实测顺序是「浏览 / 评论 / 点赞 / 收藏 / 分享」，
 *    和直觉的「浏览 / 点赞 / 评论」不一样。按位置读会把赞和评论对调，
 *    而且不报错、数字照样有，全错还查不出来。认不出来的整张卡进 unrecognized，不猜。
 * 2. **采集规格从载荷来，但规格里只有选择器和正则，没有可执行代码。**
 *    注入的函数是插件自己的，规格只作为参数传进去。绝不 eval、绝不注入服务端给的脚本。
 * 3. **域名白名单在插件侧写死。** entryUrl 的 host 不在表里直接拒绝——
 *    否则一个被改过的服务端就能让插件带着用户的登录态去访问任意站点。
 *
 * 一条都没读到时判失败，不回报空数组当成功：空数据比报错难查十倍。
 */
import { isAllowedEntryUrl, findPlatform } from "../platforms";
import { COLLECT_ERROR, CollectError } from "./collect-errors";
import type { ClaimedTask } from "../types";

/** 整个工单的上限。实测滚动一次就能把渲染进程卡到 45 秒，别按秒级设计 */
const JOB_TIMEOUT_MS = 180_000;
/** 等列表第一次出现的上限 */
const CARDS_APPEAR_TIMEOUT_MS = 60_000;
/** 轮询列表出现的间隔 */
const POLL_INTERVAL_MS = 1_000;
/** 连续这么多次卡片数没变就认为到底了 */
const STABLE_ROUNDS_TO_STOP = 2;

export interface CollectSpec {
  cardSelector: string;
  titleSelector: string;
  timeSelector: string;
  statSelector: string;
  /** svg path 的 d 属性前缀 → 指标名。按前缀匹配，因为 d 很长且可能带精度差异 */
  metricByIconPrefix: Record<string, string>;
  totalCountPattern?: string;
  maxScrolls?: number;
  scrollSettleMs?: number;
}

export interface SyncCreatorNotesPayload {
  platform: string;
  accountId?: string;
  entryUrl: string;
  spec: CollectSpec;
}

export interface CollectedNote {
  title: string;
  titleTruncated: boolean;
  publishedAtText: string;
  metrics: Record<string, number>;
}

export interface UnrecognizedNote {
  title: string;
  publishedAtText: string;
  rawNumbers: string[];
  unknownPrefixes: string[];
}

export interface SyncCreatorNotesResult extends Record<string, unknown> {
  collectedAt: string;
  platform: string;
  accountHint: string | null;
  totalClaimed: number | null;
  loadedCount: number;
  reachedEnd: boolean;
  notes: CollectedNote[];
  unrecognized: UnrecognizedNote[];
  warnings: string[];
}

/** 载荷校验。缺字段就直接说清楚缺哪个，别等注入之后才崩在页面里 */
export function parsePayload(raw: Record<string, unknown>): SyncCreatorNotesPayload {
  const platform = typeof raw.platform === "string" ? raw.platform : "";
  if (!platform) throw new CollectError(COLLECT_ERROR.SPEC_INVALID, "载荷里没有 platform");
  if (!findPlatform(platform)) throw new CollectError(COLLECT_ERROR.SPEC_INVALID, `这个插件版本不认识平台「${platform}」`);

  const entryUrl = typeof raw.entryUrl === "string" ? raw.entryUrl : "";
  if (!entryUrl) throw new CollectError(COLLECT_ERROR.SPEC_INVALID, "载荷里没有 entryUrl");
  if (!isAllowedEntryUrl(platform, entryUrl)) {
    throw new CollectError(COLLECT_ERROR.ENTRY_URL_NOT_ALLOWED, `地址不在允许的域名里：${entryUrl}`);
  }

  const spec = raw.spec as CollectSpec | undefined;
  if (!spec || typeof spec !== "object") throw new CollectError(COLLECT_ERROR.SPEC_INVALID, "载荷里没有 spec");
  for (const key of ["cardSelector", "titleSelector", "timeSelector", "statSelector"] as const) {
    if (typeof spec[key] !== "string" || !spec[key]) throw new CollectError(COLLECT_ERROR.SPEC_INVALID, `spec 里缺 ${key}`);
  }
  if (!spec.metricByIconPrefix || typeof spec.metricByIconPrefix !== "object") {
    throw new CollectError(COLLECT_ERROR.SPEC_INVALID, "spec 里缺 metricByIconPrefix，没有它只能按位置猜指标，不允许");
  }

  return {
    platform,
    accountId: typeof raw.accountId === "string" ? raw.accountId : undefined,
    entryUrl,
    spec,
  };
}

export async function runSyncCreatorNotes(task: ClaimedTask): Promise<SyncCreatorNotesResult> {
  return collect(parsePayload(task.payload ?? {}));
}

/**
 * 真正的采集流程。本地试跑也走这里，保证试跑跟工单跑的是同一份代码——
 * 两份实现迟早会分叉，那时候试跑通过就不说明工单能通过了。
 */
export async function collect(payload: SyncCreatorNotesPayload): Promise<SyncCreatorNotesResult> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  const spec = payload.spec;
  const maxScrolls = clampInt(spec.maxScrolls, 1, 200, 40);
  const settleMs = clampInt(spec.scrollSettleMs, 200, 10_000, 1_500);
  const warnings: string[] = [];

  // 托管窗口：不聚焦，免得抢用户正在用的窗口；跑完一定关掉
  const win = await chrome.windows.create({
    url: payload.entryUrl,
    focused: false,
    width: 1280,
    height: 900,
  });
  const tabId = win?.tabs?.[0]?.id;
  if (!win?.id || tabId === undefined) throw new CollectError(COLLECT_ERROR.FAILED, "开不了托管窗口");

  try {
    await waitForTabComplete(tabId, Math.min(60_000, remaining(deadline)));

    // 列表出现之前什么都别做——没登录时页面会停在登录页，这里就会超时
    const appeared = await waitForCards(tabId, spec.cardSelector, Math.min(CARDS_APPEAR_TIMEOUT_MS, remaining(deadline)));
    if (!appeared) {
      throw new CollectError(
        COLLECT_ERROR.NOT_LOGGED_IN,
        `等了 ${Math.round(CARDS_APPEAR_TIMEOUT_MS / 1000)} 秒列表也没出现。多半是这台机器没登录${findPlatform(payload.platform)?.name ?? payload.platform}，先在浏览器里登录一次`,
      );
    }

    // 滚动加载：页面 body 不滚，是内层容器在滚，所以从卡片往上找最近的可滚动祖先
    let lastCount = await countCards(tabId, spec.cardSelector);
    let stableRounds = 0;
    let reachedEnd = false;
    let scrolls = 0;

    while (scrolls < maxScrolls) {
      if (remaining(deadline) < settleMs + 5_000) {
        warnings.push("时间不够了，没滚到底就停了");
        break;
      }
      scrolls += 1;
      await runInTab(tabId, pageScrollToBottom, [spec.cardSelector]);
      await sleep(settleMs);

      const count = await countCards(tabId, spec.cardSelector);
      if (count === lastCount) {
        stableRounds += 1;
        if (stableRounds >= STABLE_ROUNDS_TO_STOP) {
          reachedEnd = true;
          break;
        }
      } else {
        stableRounds = 0;
        lastCount = count;
      }
    }

    // 滚到上限没到底只告警、不判失败：已经读到的那些是真数据，
    // 判失败会把它们一起丢掉，而下一次采集大概率还是滚到同一个上限。
    // 服务端拿 reachedEnd=false 就知道这一次的数据不保证是全的
    if (!reachedEnd && scrolls >= maxScrolls) {
      warnings.push(`[${COLLECT_ERROR.SCROLL_LIMIT_REACHED}] 滚动 ${maxScrolls} 次后仍在加载，可能没到底`);
    }

    const extracted = await runInTab(tabId, pageExtract, [spec]);
    if (!extracted) throw new CollectError(COLLECT_ERROR.LIST_NOT_APPEARED, "页面没有返回采集结果");

    const total = extracted.notes.length + extracted.unrecognized.length;
    if (total === 0) {
      throw new CollectError(
        COLLECT_ERROR.EMPTY_RESULT,
        "一条都没读到。要么选择器过时了，要么这个账号确实没有作品",
      );
    }
    // 一张卡都没认出指标：图标指纹整套过时了。这种情况下 notes 是空的，
    // 回成功等于把一次「全错」记成一次「这个账号没作品」
    if (extracted.notes.length === 0) {
      throw new CollectError(
        COLLECT_ERROR.METRIC_UNRECOGNIZED,
        `${extracted.unrecognized.length} 张卡的指标图标一个都认不出来，采集规格里的图标指纹该更新了`,
      );
    }
    if (extracted.unrecognized.length > 0) {
      warnings.push(`${extracted.unrecognized.length} 张卡的指标图标认不出来，已单独列出，没有猜值`);
    }

    return {
      collectedAt: new Date().toISOString(),
      platform: payload.platform,
      accountHint: extracted.accountHint,
      totalClaimed: extracted.totalClaimed,
      loadedCount: total,
      reachedEnd,
      notes: extracted.notes,
      unrecognized: extracted.unrecognized,
      warnings,
    };
  } finally {
    await chrome.windows.remove(win.id).catch(() => {});
  }
}

// ---- 跟页面打交道的小工具 ----

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function runInTab<A extends unknown[], R>(
  tabId: number,
  func: (...args: A) => R,
  args: A,
): Promise<R | undefined> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return injection?.result as R | undefined;
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    function onUpdated(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    // 有可能注册监听时已经加载完了，补查一次
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(() => finish());
  });
}

async function countCards(tabId: number, cardSelector: string): Promise<number> {
  return (await runInTab(tabId, pageCountCards, [cardSelector])) ?? 0;
}

async function waitForCards(tabId: number, cardSelector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await countCards(tabId, cardSelector)) > 0) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

// ---- 下面几个函数会被序列化后注入页面，必须自包含：不能引用模块作用域的任何东西 ----

function pageCountCards(cardSelector: string): number {
  return document.querySelectorAll(cardSelector).length;
}

/**
 * 滚到底。页面 body 不滚，滚的是内层容器，
 * 所以从第一张卡往上找最近的「能滚且还有的滚」的祖先。
 */
function pageScrollToBottom(cardSelector: string): boolean {
  const card = document.querySelector(cardSelector);
  if (!card) return false;

  let node: HTMLElement | null = card.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const scrollable = /(auto|scroll|overlay)/.test(style.overflowY);
    if (scrollable && node.scrollHeight > node.clientHeight + 4) {
      node.scrollTop = node.scrollHeight;
      return true;
    }
    node = node.parentElement;
  }

  // 找不到内层滚动容器就退回滚整个文档
  window.scrollTo(0, document.documentElement.scrollHeight);
  return true;
}

interface PageExtractResult {
  accountHint: string | null;
  totalClaimed: number | null;
  notes: CollectedNote[];
  unrecognized: UnrecognizedNote[];
}

function pageExtract(spec: CollectSpec): PageExtractResult {
  // --- 以下全部内联，注入进来之后拿不到模块作用域 ---

  /** 「1.2万」「3,030」这类都要能转。转不了返回 null，由调用方决定怎么办 */
  const parseNumber = (raw: string): number | null => {
    const text = raw.replace(/[,\s]/g, "").trim();
    if (!text) return null;
    const match = text.match(/^([\d.]+)\s*([万亿]?)$/);
    if (!match) return null;
    const base = Number.parseFloat(match[1]);
    if (!Number.isFinite(base)) return null;
    if (match[2] === "万") return Math.round(base * 10_000);
    if (match[2] === "亿") return Math.round(base * 100_000_000);
    return Math.round(base);
  };

  /**
   * 标题是不是被平台截断了。
   * 不能只看末尾有没有省略号——实测有条标题自带「……」，那不是截断。
   * 要看 CSS 真的在做省略，而且内容确实超宽。
   */
  const isTruncated = (el: Element): boolean => {
    const style = getComputedStyle(el);
    const ellipsis = style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none";
    return ellipsis && el.scrollWidth > el.clientWidth + 1;
  };

  const notes: CollectedNote[] = [];
  const unrecognized: UnrecognizedNote[] = [];

  const cards = Array.from(document.querySelectorAll(spec.cardSelector));
  for (const card of cards) {
    const titleEl = card.querySelector(spec.titleSelector);
    const timeEl = card.querySelector(spec.timeSelector);
    const title = (titleEl?.textContent ?? "").trim();
    const publishedAtText = (timeEl?.textContent ?? "").trim();

    const stats = Array.from(card.querySelectorAll(spec.statSelector));
    const metrics: Record<string, number> = {};
    const rawNumbers: string[] = [];
    const unknownPrefixes: string[] = [];

    for (const stat of stats) {
      const numberText = (stat.textContent ?? "").trim();
      rawNumbers.push(numberText);

      // 按图标认，绝不按位置认
      const path = stat.querySelector("svg path");
      const d = path?.getAttribute("d") ?? "";
      let metricName: string | null = null;
      for (const prefix of Object.keys(spec.metricByIconPrefix)) {
        if (d.startsWith(prefix)) {
          metricName = spec.metricByIconPrefix[prefix];
          break;
        }
      }

      if (!metricName) {
        unknownPrefixes.push(d.slice(0, 40));
        continue;
      }
      const value = parseNumber(numberText);
      if (value === null) {
        unknownPrefixes.push(`${metricName}:无法解析「${numberText}」`);
        continue;
      }
      metrics[metricName] = value;
    }

    if (unknownPrefixes.length > 0 || Object.keys(metrics).length === 0) {
      unrecognized.push({ title, publishedAtText, rawNumbers, unknownPrefixes });
      continue;
    }

    notes.push({
      title,
      titleTruncated: titleEl ? isTruncated(titleEl) : false,
      publishedAtText,
      metrics,
    });
  }

  // 「全部 65」这类标签，用来对比实际加载到了多少
  let totalClaimed: number | null = null;
  if (spec.totalCountPattern) {
    try {
      const re = new RegExp(spec.totalCountPattern);
      for (const el of Array.from(document.querySelectorAll("div,span,li,a,button"))) {
        const text = (el.textContent ?? "").trim();
        if (text.length > 24) continue;
        const m = text.match(re);
        if (m && m[1]) {
          totalClaimed = Number.parseInt(m[1], 10);
          break;
        }
      }
    } catch {
      /* 正则不合法就当没给，不要让整次采集失败 */
    }
  }

  // 账号名只是给服务端做参考，读不到就留空，别猜
  const accountHintEl = document.querySelector('[class*="account-name"], [class*="user-name"], [class*="nickname"]');
  const accountHint = (accountHintEl?.textContent ?? "").trim() || null;

  return { accountHint, totalClaimed, notes, unrecognized };
}
