# dsh for Obsidian

> Use **DeepSeek Harness (dsh)** inside [Obsidian](https://obsidian.md) — a Claudian-style local AI agent for your vault.

## What is this?

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) is a local-first AI agent runtime. This plugin wires that agent into Obsidian so you can **chat with it, summarize/translate/rewrite your notes, and drive it right from your vault** — without leaving the app.

Modeled on the same pattern as the **Claudian** plugin: the plugin is a thin shell that spawns a **local CLI agent** (here `dsh --profile headless`), instead of calling a remote model.

```
┌──────────────── Obsidian (local) ────────────────┐
│  [ dsh-for-obsidian chat panel / commands ]      │
│          │   spawns a local dsh subprocess       │
│          ▼                                        │
└──────────┴───────────────────────────────────────┘
           ▼
   [ dsh --profile headless ]   ← the local agent "brain"
```

Unlike "cloud-shell" plugins, dsh runs entirely locally — **local shell + local brain**.

## Features

- **Chat panel** — converse with a local dsh agent in a sidebar; the active note is attached as context.
- **Note commands** — Summarize / Translate / Rewrite the selected text, backed by dsh.
- **Flexible write-back** — append to note / overwrite selection / insert at cursor / new note.
- **Connection test** — Settings includes a one-click test of the dsh CLI.
- **Local & private** — no remote model call from the plugin; dsh runs on your machine.
- **Bilingual UI** — the panel auto-follows the Obsidian app language (English / Chinese). Requires Obsidian **1.8.7+**.

## Requirements

- Obsidian **desktop** (the plugin spawns a local process, so it is desktop-only).
- **Node.js** (for the dsh CLI).
- The **dsh CLI** installed globally:

```bash
npm i -g @deepseek-ai/dsh
```

> dsh spawns the LLM it is configured to use (e.g. DeepSeek) via its own configuration. The plugin never reads or stores your API keys.

## Install

Because this is not yet published to the community plugin store, use a **manual / BRAT** install:

1. Build the plugin (or use a released artifact):
   ```bash
   cd obsidian-plugin
   npm install
   npm run build        # produces main.js + manifest.json + styles.css
   ```
2. In Obsidian, open **Settings → Community plugins → Turn off Safe mode**.
3. Click **Browse → open the vault folder** and navigate to:
   `YourVault/.obsidian/plugins/`
4. Create a folder named `obsidian-dsh` and copy the built `main.js`, `manifest.json`, and `styles.css` into it.
5. Back in Obsidian, enable **dsh for Obsidian** in Community plugins.

Alternatively install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) pointing at this repository.

## Usage

- **Chat**: click the bot ribbon icon (or run the `Open dsh Chat` command). Type and press Enter to send. The active markdown note is automatically attached as context (configurable).
- **Commands** (from the command palette, with text selected):
  - `dsh: Summarize selection`
  - `dsh: Translate selection to English`
  - `dsh: Rewrite selection`
- **Write-back**: set the default in Settings (`append` / `overwrite_selection` / `insert_cursor` / `new_note`).
- **Test connection**: Settings → `Run test` to verify dsh works before relying on the plugin.

## Development

```bash
cd obsidian-plugin
npm install
npm run dev        # watch mode (esbuild)
npm run build      # type-check + production bundle
```

## How it connects to dsh

Phase 1 uses the dsh headless entry point:

```bash
dsh --profile headless "your task"
```

This prints the final assistant message and exits. The plugin spawns this subprocess via `child_process`. A Phase 2 upgrade to a resident local HTTP service is planned for streaming output.

## Status

Working Phase 1 plugin: chat panel + note commands via the headless bridge. See [`design/ARCHITECTURE.md`](design/ARCHITECTURE.md) and [`design/ROADMAP.md`](design/ROADMAP.md).

## License

[MIT](LICENSE)

---

## 中文简介（Chinese）

**dsh for Obsidian** 把本地优先的 DeepSeek Harness (dsh) 智能体接进 Obsidian，让你在笔记工具里直接与 dsh 对话、总结/翻译/改写笔记、并读写你的 vault。
对标 **Claudian** 同样采用 **本地壳 + 本地大脑** 模式：插件只是薄壳，通过 `child_process` 派生本地的 `dsh --profile headless`，不调用远程模型、也绝不接触你的密钥。

设计细节见 `design/ARCHITECTURE.md`（中文）与 `design/ROADMAP.md`（开发里程碑）。
