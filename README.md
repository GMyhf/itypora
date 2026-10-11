# iTypora

Electron + TypeScript + Milkdown Crepe 实现的类 Typora 所见即所得 Markdown 编辑器（面向 macOS）。

## 命令
- `npm install`
- `npm start` 构建并启动
- `npm run dist` 打包 macOS universal dmg（未签名，首次打开右键“打开”）
- `npm test` 单元测试；`npm run test:smoke -- <临时目录>` Electron 冒烟测试（需要 xvfb 或真实显示器）

## 安装排错
- 安装时报 `Electron failed to install correctly` / `fetch failed`：说明从 GitHub 下载 Electron 二进制失败。请用镜像环境变量重装：`rm -rf node_modules/electron && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install`（`.npmrc` 中的 `electron_mirror` 在较新的 npm 下会提示 Unknown config，后续版本可能失效）。也可设置代理（如 `export HTTPS_PROXY=http://127.0.0.1:7890`），或手动执行 `node node_modules/electron/install.js`。
- `npm warn allow-scripts`（`electron-winstaller`、`fsevents`）可忽略，不影响 macOS 开发与运行。
- 建议使用 Node LTS（20/22）；过新的 Node 版本可能出现兼容问题。

## 结构
- `src/main/` 主进程：窗口与多文档状态、菜单、文件读写/监视、图片落盘、导出、设置
- `src/renderer/` 渲染进程：编辑器封装 `editor.ts`、ProseMirror 插件 `plugins.ts`（查找/专注/粘贴图片）、侧边栏、主题
- 主题：`themes/themes.css` 覆盖 Crepe CSS 变量；自定义主题放 `~/Library/Application Support/iTypora/themes/*.css`

## 行为约定
- 图片保存到 `<文档名>.assets/`，Markdown 中用相对路径；未命名文档的图片先放临时目录，首次保存时迁移
- 已有路径的文档停止输入 2 秒自动保存；未命名文档每 3 秒写恢复文件，崩溃后下次启动提示恢复
- 导出 HTML/PDF 用 markdown-it 渲染（不含 KaTeX 公式）
