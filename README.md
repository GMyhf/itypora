# iTypora

Electron + TypeScript + Milkdown Crepe 实现的类 Typora 所见即所得 Markdown 编辑器（面向 macOS）。

## 命令
- `npm install`
- `npm start` 构建并启动
- `npm run dist` 打包 macOS universal dmg（未签名，首次打开右键“打开”）
- `npm test` 单元测试；`npm run test:smoke -- <临时目录>` Electron 冒烟测试（需要 xvfb 或真实显示器）

## 打包与分发
- `npm run dist` 在 `release/` 下生成 arm64 的 `.app` 和 dmg（约 105 MB，Electron 框架本身占大头）。终端命令不走系统代理，下载 dmg 工具失败时先 `export HTTPS_PROXY=...`。
- 未购买 Apple Developer 证书（99 美元/年），应用**未签名、未公证**，决定如下：
  - **只在自己的 Mac 上用**：不需要证书。本机打包的应用没有隔离标记，把 `release/mac-arm64/iTypora.app` 拷到 `/Applications` 即可正常打开。
  - **发给同学或学生**：对方首次打开需右键 → 打开；部分新版 macOS 还要到“系统设置 → 隐私与安全性”点“仍要打开”。人少时把这个步骤告诉对方即可，不必花钱。
  - **公开发布**时再考虑办证书：加入 Apple Developer Program，创建 Developer ID Application 证书，并在 `build.mac` 里开启 `notarize`，配置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

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
- 导出 HTML/PDF 用 markdown-it + KaTeX 渲染（支持 `$..$`、`\(..\)`、`$$..$$` 公式）；PDF 带书签导航（Typora 的左侧导航），HTML 带左侧目录
- 图床：偏好设置里可选 PicGo 应用（默认 `http://127.0.0.1:36677/upload`；PicGo 没运行时会自动启动）或自定义命令（命令末尾追加图片路径，取 stdout 中最后一个 URL，同 Typora）。粘贴/插入的图片始终先存本地；在图片上右键“上传图片到图床”上传单张并替换链接，或用“编辑 → 上传所有本地图片”批量上传
