/**
 * 工单明细：派下来的载荷和回报上去的结果，本地留一份给人看。
 *
 * 存的是**已经格式化好的 JSON 文本**而不是对象：
 * 这两样只有「显示出来给人看」这一个用途，存文本省掉了每次打开详情都重新
 * 序列化一遍，也让「太大了要截断」这件事只需要处理一次、而且截断得明明白白。
 */

/** 单条明细最多留这么多字符。一次采集 65 条帖子的结果大约 20KB，留得下 */
const MAX_DETAIL_CHARS = 32 * 1024;

export interface JobDetail {
  /** 缩进好的 JSON；不是对象的（比如一句错误原因）就是原文 */
  text: string;
  /** 太大截断过，后面的内容看不到了 */
  truncated: boolean;
}

export function toJobDetail(value: unknown): JobDetail | null {
  if (value === undefined || value === null) return null;

  const text = typeof value === "string" ? value : stringify(value);
  if (text.length <= MAX_DETAIL_CHARS) return { text, truncated: false };

  return { text: text.slice(0, MAX_DETAIL_CHARS), truncated: true };
}

/**
 * 序列化失败也要留下点东西。
 * 载荷里出现循环引用不该让整条记录变成空白——那样人就只能对着一个
 * 「失败了」发呆，而排查恰恰需要看见当时派下来的是什么。
 */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
