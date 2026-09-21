/**
 * 采集失败的错误码，跟服务端 `ResponseCode` 的 20700 段一一对应
 * （contract-collect-xhs 第三节「错误码」）。
 *
 * 为什么要码而不是只给一句话：这些失败里有一半需要用户去做点什么
 * （去登录、更新采集规格、换个地址），网页要能按类型给出对应的引导。
 * 只有一段中文的话，网页只能原样显示，判断类型就得去匹配字符串。
 *
 * 码写在 message 的最前面（`[20701] 还没登录`），服务端从 `lastError` 里解出来。
 * 走 message 而不是另开一个字段，是因为工单回报的失败只有 `error` 一个字符串字段，
 * 加字段要同时改插件、服务端 DTO 和数据库，而这三样都在不同的发布节奏上。
 */
export const COLLECT_ERROR = {
  ENTRY_URL_NOT_ALLOWED: 20700,
  NOT_LOGGED_IN: 20701,
  LIST_NOT_APPEARED: 20702,
  EMPTY_RESULT: 20703,
  SCROLL_LIMIT_REACHED: 20704,
  METRIC_UNRECOGNIZED: 20705,
  SPEC_INVALID: 20706,
  FAILED: 20707,
} as const;

export class CollectError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`[${code}] ${message}`);
    this.name = "CollectError";
    this.code = code;
  }
}
