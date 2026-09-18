import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

/**
 * 扩展清单。
 * 只申请真正用得上的权限；不写死 key，扩展 ID 由加载路径决定。
 */
export default defineManifest({
  manifest_version: 3,
  name: "AiToEarn 执行端",
  version: pkg.version,
  description: "自研 AiToEarn 执行端：在浏览器里跑智能体、领任务、回报结果。",
  default_locale: "zh_CN",

  // debugger 暂不申请：目前没有需要模拟真实鼠标的场景，要用再加。
  permissions: [
    "tabs",
    "activeTab",
    "windows",
    "sidePanel",
    "storage",
    "alarms",
    "notifications",
    "scripting",
    "downloads",
  ],
  optional_permissions: ["cookies"],
  host_permissions: ["<all_urls>"],

  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },

  side_panel: {
    default_path: "src/sidebar/index.html",
  },

  action: {
    default_title: "AiToEarn 执行端",
  },

  // 暂时不注册内容脚本：Eko 的 BrowserAgent 用 chrome.scripting 现场注入函数，
  // 不需要常驻脚本。等第 4 批做平台专用页面操作时再加回来。
});
