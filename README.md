# AiToEarn 执行端

一个 Chrome 扩展：在浏览器侧边栏里跟 AI 智能体对话，让它去操作网页；也可以建定时任务，让它每天到点自己跑。

配合自部署的 [AiToEarn](https://github.com/yikart/AiToEarn) 后端使用，模型走后端转发，插件本身不存任何模型 Key。

## 能做什么

- **聊天**：说一句「打开某个页面，把标题和正文第一段告诉我」，它会自己开标签页、读内容、回答
- **定时任务**：设好每天几点跑，到点自动开一个独立窗口执行，跑完关掉，留一份运行记录（步骤、耗时、结果）
- **开箱检查**：打开插件先确认服务器和凭证有没有配好，没配好就只显示引导页

长期目标是做成一个**执行端**：后台统一派任务，各台电脑上的插件定时领任务、执行、回报结果，不依赖网页开着。

## 装

从 [Releases](../../releases) 下载最新的 zip 解压，打开 `chrome://extensions`，右上角开「开发者模式」，点「加载已解压的扩展程序」，选解压出来的文件夹。

装好后点插件图标打开侧边栏，按引导填服务器地址、同步登录凭证。

## 开发

```bash
pnpm install
pnpm build     # 产物在 dist/
pnpm dev       # 开发模式
```

main 分支每次 push 会自动构建并发一个 Release，见 [.github/workflows](.github/workflows/)。

## 技术栈

Vite 8 + [@crxjs/vite-plugin](https://github.com/crxjs/chrome-extension-tools) + React 19 + Tailwind 4 + zustand，MV3。

智能体部分直接用上游的 [Eko](https://github.com/FellouAI/eko)（MIT）：`@eko-ai/eko` 负责对话、规划和工具调用，`@eko-ai/eko-extension` 负责在扩展里操作浏览器。这个项目只做上面那一层——模型接入、任务调度、界面。

## 进度

见 [docs/进度.md](docs/进度.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。
