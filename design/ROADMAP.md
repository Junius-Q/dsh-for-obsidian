# dsh for Obsidian — 开发路线图 (Roadmap)

> 配套文档：`design/ARCHITECTURE.md`
> 原则：Phase 1 用 `dsh --profile headless` 快速跑通闭环，Phase 2 演进到本地 HTTP 服务以获得流式体验。

---

## M0 · 项目脚手架
- [ ] Obsidian 插件骨架：`manifest.json` + `main.ts` + `esbuild.config.mjs` + `package.json`
- [ ] 空插件能在 Obsidian 中启用（settings 面板占位）
- [ ] 建立 GitHub 仓库 `dsh-for-obsidian`，MIT LICENSE，README 占位

**验收**：在 Obsidian 里能加载插件并打开设置页。

---

## M1 · headless Bridge 打通
- [ ] `bridge/dshCli.ts`：封装 `dsh --profile headless "<指令>"` 子进程调用
- [ ] `bridge/promptBuilder.ts`：指令 + 当前 note 附加上下文
- [ ] 结果解析：捕获 stdout/stderr，提取最终文本
- [ ] `dsh 自检`：插件启动时检测 dsh 是否可用，未安装时给出引导提示

**验收**：通过插件命令执行一条 dsh 任务（如"用一句话说明这是什么主题"）并在界面回显。

---

## M2 · 命令式文本处理
- [ ] `commands/summarize.ts` 总结
- [ ] `commands/translate.ts` 翻译
- [ ] `commands/rewrite.ts` 改写
- [ ] 结果写入策略：追加/覆盖选中/光标后插入/新建笔记，均接入 settings
- [ ] 危险操作二次确认 Modal

**验收**：选中笔记文本，执行"总结"，结果按所选策略写回 vault。

---

## M3 · 聊天面板
- [ ] `panel/ChatView.ts`：右侧边栏聊天界面
- [ ] 会话上下文管理（请求携带历史/当前 note）
- [ ] 渲染 dsh 文本回复，支持 Markdown 高亮

**验收**：在一个侧边栏面板里连续对话 dsh，并引用当前笔记。

---

## M4 · 本地 HTTP 服务（Phase 2）
- [ ] 引导常驻 dsh web 服务，仅绑定 `127.0.0.1`
- [ ] `bridge/dshHttp.ts`：本机 HTTP/WebSocket 客户端
- [ ] 随机 token 鉴权
- [ ] 流式输出 + 中断当前生成

**验收**：聊天体验变为流式打字，可中途停止，多会话切换。

---

## M5 · 发布与分发
- [ ] 打包插件产物（`main.js` + `manifest.json` + `styles.css`）
- [ ] BRAT JSON 配置（测试期分发）
- [ ] 社区插件市场提交材料（按 Obsidian 规范）
- [ ] 完善 README（安装、配置、截图、常见问题）

**验收**：用户可通过 BRAT 安装，或从社区市场安装。

---

## 后续增强（Backlog）
- [ ] 标签/文件搜索驱动 dsh（Agent 读写 vault）
- [ ] 定时任务（Obsidian 里调度 dsh 自动整理）
- [ ] 命令面板多命令模板
- [ ] 移动端（Obsidian iOS 无 Node，仅托管云后端时）—— 明确非目标或作为 Future Work

---

**当前状态**：M0 ~ M5 待开始，建议从 M0 起逐项推进。
