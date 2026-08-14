# dsh for Obsidian

> 在 [Obsidian](https://obsidian.md) 中使用 **DeepSeek Harness (dsh)** — 一个仿 Claudian 风格的本地 AI 智能体，为你处理 vault 中的笔记。

## 这是什么？

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）是一个本地优先的 AI 智能体运行时。本插件将它接入 Obsidian，让你**在笔记工具里直接与 dsh 对话、总结/翻译/改写笔记、并读写你的 vault**——无需离开应用。

与 **Claudian** 插件采用相同的模式：插件只是一个薄壳，驱动本地的 **CLI 智能体**（`dsh`），而不是调用远程模型。

```
┌──────────────── Obsidian（本地）────────────────┐
│  [ dsh-for-obsidian 聊天面板 / 命令 ]          │
│          │   本地 HTTP（requestUrl）            │
│          ▼                                      │
└──────────┴─────────────────────────────────────┘
           ▼
   [ dsh --profile web ]   ← 本地智能体 "大脑"
                             （必要时回退到 headless）
```

与 "cloud-shell" 类插件不同，dsh 完全在本地运行 —— **本地壳 + 本地大脑**。

## 功能

- **聊天面板** — 在侧边栏与本地 dsh 智能体对话；自动附加当前笔记作为上下文。回复以 Markdown 格式实时（轮询）显示。
- **模型 / 权限 / 推理等级控制** — 直接在输入栏切换模型、权限预设、推理等级。
- **上下文用量环** — 点击查看 token 用量 / 上下文窗口占用。
- **会话历史** — 列出、重命名、归档、分叉会话（右键历史会话）。
- **笔记命令** — 总结 / 翻译 / 改写选中的文本，由 dsh 处理。
- **灵活写回** — 追加到笔记 / 覆盖选中 / 插入光标处 / 新建笔记。
- **API key 配置** — 可在聊天面板 ⚙ 菜单或插件设置中填写 DeepSeek key，写入 dsh 自身配置，插件/CLI/web 通用。
- **连接测试** — 设置里提供一键测试 dsh CLI。
- **本地与隐私** — 插件不调用远程模型；dsh 在你的机器上运行。
- **双语 UI** — 面板自动跟随 Obsidian 界面语言（英文 / 中文）。需要 Obsidian **1.8.7+**。

## 环境要求

- Obsidian **桌面版**（插件会派生本地进程，仅桌面端可用）。
- **Node.js**（用于 dsh CLI）。
- 全局安装 **dsh CLI**：

```bash
npm i -g @deepseek-ai/dsh
```

> dsh 通过自身配置来调用它配置的模型（例如 DeepSeek）。你可以在聊天面板的 ⚙ 菜单或插件设置中填写 API key — 它会存到 dsh 的凭据文件（`~/.dsh/.credentials.yaml`），插件、CLI、web UI 共用。

## 安装

由于尚未发布到社区插件市场，使用**手动 / BRAT** 安装：

1. 构建插件（或使用发布产物）：
   ```bash
   cd obsidian-plugin
   npm install
   npm run build          # 生成 main.js + manifest.json + styles.css
   ```
2. 在 Obsidian 中打开 **设置 → 第三方插件 → 关闭安全模式**。
3. 点击 **浏览 → 打开 vault 文件夹**，进入：
   `YourVault/.obsidian/plugins/`
4. 新建一个名为 `obsidian-dsh` 的文件夹，把构建好的 `main.js`、`manifest.json`、`styles.css` 放进去。
5. 回到 Obsidian，在第三方插件中启用 **dsh for Obsidian**。

或者用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 指向本仓库安装。

## 使用

- **聊天**：点击机器人图标（或运行 `Open dsh Chat` 命令）。输入并按 Enter 发送。当前 markdown 笔记会自动附加为上下文（可配置）。
- **命令**（命令面板，需先选中文本）：
  - `dsh: Summarize selection`（总结选中内容）
  - `dsh: Translate selection to English`（翻译为英文）
  - `dsh: Rewrite selection`（改写选中内容）
- **写回**：在设置里设置默认方式（`append` / `overwrite_selection` / `insert_cursor` / `new_note`）。
- **测试连接**：设置 → `Run test`，确认 dsh 可用后再依赖插件。

## 开发

```bash
cd obsidian-plugin
npm install
npm run dev        # 监听模式（esbuild）
npm run build      # 类型检查 + 生产打包
```

## 如何连接 dsh

插件会在 `127.0.0.1`（随机端口）拉起常驻的本地 `dsh --profile web` HTTP 服务，并通过 JSON-RPC 风格 API 与之通信。聊天消息提交到 dsh 会话后，轮询 `session.history` 获取回复，因此输出能流式地进入面板。

如果 HTTP 服务无法启动（例如 dsh CLI 缺失或配置问题），插件会回退到无头入口：

```bash
dsh --profile headless "your task"
```

## 状态

可用的 Phase 2 插件：聊天面板基于常驻本地 dsh HTTP 服务（流式、模型/权限/推理控制、会话历史），并带有笔记命令和 headless 回退。详见 [`design/ARCHITECTURE.md`](design/ARCHITECTURE.md) 与 [`design/ROADMAP.md`](design/ROADMAP.md)。

## 许可

[MIT](LICENSE)
