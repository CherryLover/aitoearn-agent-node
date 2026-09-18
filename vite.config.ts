import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import manifest from "./manifest.config.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // service worker 和内容脚本不能有顶层 await 之外的花活，保守一点用 chrome 支持的目标
    target: "chrome120",
    sourcemap: true,
    rollupOptions: {
      output: {
        // 把体积大的依赖单独切出来，方便看每块多大
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@eko-ai")) return "vendor-eko";
          if (id.includes("@ai-sdk") || id.includes("/ai/") || id.includes("zod")) return "vendor-ai";
          if (id.includes("react")) return "vendor-react";
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
