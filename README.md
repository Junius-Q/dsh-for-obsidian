# dsh for Obsidian

> **English** · [**中文 (Chinese)**](README.zh.md)

> Use **DeepSeek Harness (dsh)** inside [Obsidian](https://obsidian.md) — a Claudian-style local AI agent for your vault.

## What is this?

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) is a local-first AI agent runtime. This plugin wires that agent into Obsidian so you can **chat with it, summarize/translate/rewrite your notes, and drive it right from your vault** — without leaving the app.

Modeled on the same pattern as the **Claudian** plugin: the plugin is a thin shell that drives a **local CLI agent** (`dsh`), instead of calling a remote model.

```
┌──────────────── Obsidian (local) ────────────────┐
│  [ dsh-for-obsidian chat panel / commands ]      │
│          │   local HTTP (requestUrl)             │
│          ▼                                        │
└──────────┴───────────────────────────────────────┘
           ▼
   [ dsh --profile web ]   ← the local agent "brain",
                             falling back to headless
```

Unlike "cloud-shell" plugins, dsh runs entirely locally — **local shell + local brain**.

## Features

- **Chat panel** — converse with a local dsh agent in a sidebar; the active note is attached as context. Replies stream in with Markdown formatting.
- **Model / permission / reasoning controls** — switch model, permission preset, and reasoning effort right from the composer bar.
- **Context usage ring** — click to see token usage / context-window usage.
- **Session history** — list, rename, archive, and fork conversations (right-click a session).
- **Note commands** — Summarize / Translate / Rewrite the selected text, backed by dsh.
- **Flexible write-back** — append to note / overwrite selection / insert at cursor / new note.
- **API key configuration** — enter your DeepSeek key from the chat panel ⚙ menu or the plugin settings; it is written to dsh's own config and shared with the CLI and web UI.
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

> dsh spawns the LLM it is configured to use (e.g. DeepSeek) via its own configuration. You can enter your API key from the chat panel's ⚙ menu or the plugin settings — it is stored in dsh's credentials file (`~/.dsh/.credentials.yaml`) and shared across the plugin, CLI, and web UI.

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

The plugin spawns a resident local `dsh --profile web` HTTP service on `127.0.0.1` (random port) and talks to it over a JSON-RPC-style API. Chat messages are submitted to a dsh session and replies are polled from `session.history`, so output can stream into the panel.

If the HTTP service cannot start (e.g. the dsh CLI is missing or a config issue), the plugin falls back to the headless entry point:

```bash
dsh --profile headless "your task"
```

## Status

Working Phase 2 plugin: chat panel over a resident local dsh HTTP service (streaming, model/permission/reasoning controls, session history), with note commands and a headless fallback. See [`design/ARCHITECTURE.md`](design/ARCHITECTURE.md) and [`design/ROADMAP.md`](design/ROADMAP.md).

## License

[MIT](LICENSE)

