/**
 * Eko 的全局配置。
 *
 * 只改两处：
 * - name：不改的话它会自称「Eko」，用户问「你是谁」会答 Eko
 * - platform：影响浏览器智能体用的快捷键（复制、全选之类）
 *
 * 系统提示词用上游的，不动。
 */
import { config } from "@eko-ai/eko";

let applied = false;

export function setupEko(): void {
  if (applied) return;
  applied = true;
  config.name = "AiToEarn 执行端";
  config.platform = navigator.userAgent.includes("Mac") ? "mac" : "windows";
}
