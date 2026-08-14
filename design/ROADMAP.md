# dsh for Obsidian — 开发路线图 (Roadmap)

> 配套文档：`design/ARCHITECTURE.md`
> 原则：Phase 1 用 `dsh --profile headless` 快速跑通闭环，Phase 2 演进到本地 HTTP 服务以获得流式体验。

---

## M0 · 项目脚手架
- [x] Obsidian 插件骨架：`manifest.json` + `main.ts` + `esbuild.config.mjs` + `package.json`
- [x] 空插件能在 Obsidian 中启用（settings 面板占位）
- [x] 建立 GitHub 仓库 `dsh-for-obsidian`，MIT LICENSE，README

**验收**：在 Obsidian 里能加载插件并打开设置页。

---

## M1 · headless Bridge 打通
- [x] `bridge/dshCli.ts`：封装 `dsh --profile headless "<指令>"` 子进程调用
- [x] `bridge/promptBuilder.ts`：指令 + 当前 note 附加上下文
- [x] 结果解析：捕获 stdout/stderr，提取最终文本
- [x] `dsh 自检`：设置页提供「测试连接」（runTest）

**验收**：通过插件命令执行一条 dsh 任务并在界面回显。

---

## M2 · 命令式文本处理
- [x] `commands/NoteCommands.ts`：总结
- [x] `commands/NoteCommands.ts`：翻译
- [x] `commands/NoteCommands.ts`：改写
- [x] 结果写入策略：追加/覆盖选中/光标后插入/新建笔记，均接入 settings
- [ ] 危险操作二次确认 Modal（当前写回为直接执行）

**验收**：选中笔记文本，执行"总结"，结果按所选策略写回 vault。

---

## M3 · 聊天面板
- [x] `panel/ChatView.ts`：右侧边栏聊天界面
- [x] 会话上下文管理（多会话 + 当前 note 附加）
- [x] 渲染 dsh 文本回复，支持 Markdown 高亮

**验收**：在一个侧边栏面板里连续对话 dsh，并引用当前笔记。

---

## M4 · 本地 HTTP 服务（Phase 2）
- [x] 引导常驻 dsh web 服务，仅绑定 `127.0.0.1`
- [x] `bridge/dshHttp.ts`：本机 HTTP 客户端（JSON-RPC 风格）
- [x] 鉴权：loopback + `--trusted-host 127.0.0.1`（随机 token 简化）
- [x] 流式输出（轮询 `session.history`）+ 中断当前生成（Stop）

**验收**：聊天体验变为流式打字，可中途停止，多会话切换。

---

## M5 · 发布与分发
- [x] 打包插件产物（`main.js` + `manifest.json` + `styles.css`）
- [x] README（英文 + 中文双语，语言切换）
- [x] GitHub Release（tag `0.1.0`，附件 `main.js`/`manifest.json`/`styles.css`）
- [ ] BRAT JSON 配置（测试期分发）
- [ ] 社区插件市场提交材料（按 Obsidian 规范）
- [ ] 截图、常见问题（FAQ）

**验收**：用户可通过 BRAT 安装，或从社区市场安装。

---

## 后续增强（Backlog）
- [ ] 标签/文件搜索驱动 dsh（Agent 读写 vault）
- [ ] 定时任务（Obsidian 里调度 dsh 自动整理）
- [ ] 命令面板多命令模板
- [ ] 移动端（Obsidian iOS 无 Node，仅托管云后端时）—— 明确非目标或作为 Future Work

---

**当前状态**：M0 ~ M4 已完成；M5 已打包并发布 `0.1.0` Release，BRAT / 社区市场待做。
