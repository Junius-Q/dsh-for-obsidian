# dsh for Obsidian — 架构设计文档

> 项目：`dsh-for-obsidian`
> 目标：把 **DeepSeek Harness (dsh)** 的能力接入 Obsidian，形成类似 "Claude Obsidian 插件" 的本地 Agent 体验。
> 文档语言：中文（核心设计），另附英文 `README.md` 面向国际开源社区。

---

## 1. 设计定位与核心理念

### 1.1 我们要解决的问题
用户希望像使用 Claude Obsidian 插件那样，在 Obsidian 中直接与 **dsh Agent** 交互，并对 vault 里的笔记进行读取、理解、改写、整理，而不必离开 Obsidian。

### 1.2 本质架构：本地壳 + 本地大脑
Claude 插件是“本地壳 + 远程大脑”（Obsidian→Anthropic 云端）。
本项目更进一步，是 **“本地壳 + 本地大脑”**：

```
┌─────────────── Obsidian（本地）────────────────┐
│                                               │
│   [ dsh-for-obsidian 插件面板 ]                │
│        │                                       │
│        │ ① 本机 spawn / 本机 HTTP               │
│        ▼                                       │
└────────┴───────────────────────────────────────┘
         │
         ▼
   [ dsh 本地进程（复用全局 @deepseek-ai/dsh 包）]  ←── 大脑
```

### 1.3 相比“重写插件内嵌 dsh”的优势
- **不改动 dsh 核心**：dsh 以独立进程存在，升级、隔离、调试都容易。
- **复用成熟的 `dsh --profile headless` 入口**：dsh 原生支持无头模式执行单次任务并返回文本结果。
- **主线程不被阻塞**：聊天面板与 vault 操作都通过子进程/HTTP 异步执行，Obsidian 保持流畅。
- **发布友好**：插件本体只依赖 Obsidian API，dsh 作为外部可执行文件由用户另行安装/由插件引导安装。

---

## 2. 复用 dsh 的三种对接路径

调研确认全局包 `@deepseek-ai/dsh`（v0.1.0-rc.6，MIT）提供以下 CLI 形态（`lib/bin.js`）：

| 命令 | 行为 | 适用场景 |
|------|------|----------|
| `dsh --profile headless "任务"` | 无头模式，单次任务，结束后打印结果并退出 | **推荐**：简单、可靠、进程生命周期干净 |
| `dsh --profile web` | 启动内置浏览器 UI + 本地 web 服务 + API 代理 | 备选：需要流式、多会话、REST 语义时 |
| `dsh --profile tui` | 终端交互界面 | 不适用（交互在终端不在 Obsidian） |

关键内部能力（已确认存在于 dsh 局部依赖中）：
- `dsh-headless` — 无头执行器
- `dsh-host-webserver` / `dsh-host-apiproxy` — 本地 HTTP 服务与 API 代理
- `dsh-llm` 及系列 tool 包（fs、web、subagent、workflow 等）— Agent 工具集

### 2.1 推荐方案 A：headless 子进程（Phase 1）
插件用 `node:child_process` 派生：

```bash
dsh --profile headless "<用户指令 + 附带的笔记上下文>"
```

- 优点：实现最简单，一次调用一条结果，天然隔离。
- 缺点：无流式输出；每次调用冷启动开销（可热保持或用 `--resume` 会话）。

### 2.2 进阶方案 B：本地 HTTP 服务（Phase 2）
插件引导一个常驻 dsh web 服务（监听 `127.0.0.1`），插件通过本机 HTTP/WebSocket 与它通信，获得流式、多会话能力。

- 优点：体验接近 Claude 插件（流式打字、会话历史、中断）。
- 缺点：需要管理服务生命周期、端口、鉴权（仅绑定 loopback + 随机 token）。

> **决策**：Phase 1 用方案 A 跑通闭环，Phase 2 演进到方案 B。两个阶段共用相同的「指令拼装 → 结果解析 → 回写 note」抽象层，以便平滑迁移。

---

## 3. 总体模块划分

```
D:\Obsidian\DSH
├─ design/
│  ├─ ARCHITECTURE.md          # 本文档（中文）
│  └─ ROADMAP.md               # 分阶段里程碑（待创建）
├─ obsidian-plugin/            # Obsidian 插件本体（TypeScript）
│  ├─ src/
│  │  ├─ main.ts               # Obsidian 插件入口 (Plugin + manifest)
│  │  ├─ settings.ts           # 设置页（dsh 路径、端口、模型等）
│  │  ├─ bridge/
│  │  │  ├─ dshCli.ts          # 方案A：头less 子进程封装
│  │  │  ├─ dshHttp.ts         # 方案B：本地 HTTP 客户端（Phase 2）
│  │  │  └─ promptBuilder.ts   # 指令 + 笔记上下文的拼装
│  │  ├─ panel/
│  │  │  └─ ChatView.ts        # 右侧边栏聊天视图
│  │  └─ commands/
│  │     ├─ summarize.ts       # 命令：总结选中笔记
│  │     ├─ translate.ts       # 命令：翻译选中文本
│  │     └─ rewrite.ts         # 命令：改写/重写
│  ├─ manifest.json            # Obsidian 插件元数据
│  ├─ esbuild.config.mjs
│  ├─ package.json
│  └─ styles.css
├─ README.md                   # 英文项目首页
└─ LICENSE                     # MIT
```

---

## 4. 核心数据流

### 4.1 聊天面板流程（ChatView）
```
用户在面板输入
   → promptBuilder.build(输入, 当前笔记, vault 上下文)
   → bridge.dshCli.run(prompt)          // spawn `dsh --profile headless ...`
   → 捕获 stdout / stderr
   → parseResult() 提取最终结果
   → 渲染到聊天历史；请求时可替换当前笔记内容
```

### 4.2 命令式流程（选中文本处理）
```
命令执行（如 总结）
   → 读取当前 active file 选中文本
   → promptBuilder.buildTargeted("总结", selection, context)
   → bridge 调用 dsh
   → 结果按用户选择：覆盖选中 / 插入到笔记 / 新建笔记
```

### 4.3 结果写入策略（设置项）
- `apend_to_current`：追加到当前笔记末尾
- `overwrite_selection`：替换选中文本
- `insert_after_cursor`：插入光标处
- `new_note`：按模板命名放入指定目录

---

## 5. 安全与边界

- **仅绑定本机**：HTTP 服务只监听 `127.0.0.1`，端口可配置（默认取随机）。
- **token 鉴权（Phase 2）**：握手时交换一次性随机 token，防同机其他进程滥用。
- **工作目录隔离**：headless 子进程默认工作目录设为 `vault` 根目录或用户指定的 `cwd`，避免越界读写。
- **危险操作放行**：任何涉及删除/批量覆盖的操作，先以 `ask_user_question` 式确认；插件侧则以 Obsidian 原生 `Modal` 二次确认。
- **不存储密钥**：OpenAI/DeepSeek 之类的 API Key 留在 dsh 自己的配置里，插件绝不读取或落盘密钥。

---

## 6. 设置项设计（Settings）

| 设置 | 说明 | 默认 |
|------|------|------|
| `dshExecutablePath` | dsh 可执行文件路径（`dsh` / 全局安装路径） | `dsh`（PATH） |
| `bridgeMode` | `headless`（Phase1）/ `http`（Phase2） | `headless` |
| `httpPort` | Phase2 本地服务端口 | `0`(随机) |
| `workingDir` | dsh 子进程工作目录 | vault 根 |
| `defaultWriteMode` | 结果默认写入方式 | `append_to_current` |
| `model / profile` | 传给 dsh 的 profile 参数 | `headless` |
| `includeActiveNote` | 聊天时是否自动附带当前 note | `true` |
| `contextLimitChars` | 附加上下文的最大字符数 | `8000` |

---

## 7. GitHub 发布计划

- 仓库名：**`dsh-for-obsidian`**
- 命名空间：`obsidian-dsh`（建议以此作 manifest id）
- 发布渠道：
  1. **源码仓库**：完整代码 + README + LICENSE(MIT) + 贡献指南
  2. **Obsidian 社区插件市场**（可选，后续）：按 Obsidian 提交规范打包、签 BRAT/官方审核
  3. **BRAT**（Beta Reviewer's Auto-update Tool）：测试期分发

### 兼容性
- api-version：Obsidian `1.x`（`manifest.json` 需声明 `minAppVersion`）
- 平台：Windows / macOS / Linux（dsh 跨平台；spawn 路径处理需适配 Win/mac 差异）

### 里程碑（详见 ROADMAP）
- **M0** 项目脚手架 + 空插件可加载
- **M1** headless Bridge 跑通，能执行一条 dsh 任务并回显
- **M2** 命令式（总结/翻译/改写）+ 结果写入策略
- **M3** 聊天面板 + 会话上下文
- **M4** Phase2 HTTP 服务 + 流式 + 中断
- **M5** 发布体验（打包、BRAT/社区审核、文档）

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `dsh` 冷启动慢 | 缓存进程、`--resume` 会话复用、后台预热 |
| 跨平台 spawn 差异 | 抽象 `SpawningAdapter`，win 用 `cmd /c` / `wsl` 适配示例 |
| 用户未装 dsh | 设置页提供安装引导（`npm i -g @deepseek-ai/dsh`）+ 自检 |
| dsh 输出解析不稳定 | 约定结构化结果标记（如 `::dsh-result::` 包裹） |
| 长期维护负担 | 只依赖 `--profile headless` / HTTP 公开入口，不碰内部 API |

---

*初稿：基于 dsh v0.1.0-rc.6 全局包调研。继续按 ROADMAP 推进。*
