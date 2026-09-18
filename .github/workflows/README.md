# 工作流

- `release.yml`：main 分支每次 push（或手动触发）就跑一遍类型检查和构建，
  把 `dist/` 打成 zip 发一个 Release。

标签用 `v<package.json 里的版本>-b<第几次运行>`，所以不改版本号也不会撞标签。
要发一个「正式」版本，改 `package.json` 的 version 再推一次就行。
