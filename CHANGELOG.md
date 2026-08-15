# Changelog

All notable changes to **dsh for Obsidian** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-08-15

### Added
- **True approvals & questions** wired to dsh's real protocol: the plugin subscribes to
  the dsh mux stream (WebSocket, via a small node relay `bridge/dshMuxRelay.ts`) to receive
  `approval/requested` and `question/requested` frames, renders them as web-style cards
  (one question at a time, pager, custom input, skip/submit; approve/reject), and answers
  with `POST /api/respond` (`client-response`). Cancel sends `{ok:false, cancelled}`.
- **Message send queue**: while a turn is running, pressing Enter/typing enqueues messages
  into a "pending sends" card (edit ✎ / remove 🗑 / send-now →); messages drain in order
  after each turn, and "send now" interrupts the running turn.
- **Multi-step replies**: each `assistant/message` of a turn now gets its own bubble, and a
  long multi-step reply is accumulated so no intermediate paragraph is lost.
- **Process persistence**: tool calls & thinking are captured from the mux/session history
  and stored on each chat message (`chatSessions`); they replay after a reload, so
  `🧰`/`🤔` detail survives restarts. Tool calls are de-duplicated by `callId`.
- **dsh process reuse**: fixed loopback port (default 3080); the host adopts an already
  running dsh on that port (`host.describe` probe) instead of spawning a new one every
  reload; `stop()` only kills a process we spawned. Settings expose `httpPort` (0=random)
  and `killWebOnUnload` (unload-kill vs detach-and-reuse).
- **Session restore**: the currently active chat session id is remembered
  (`activeChatId`) and restored on reopen.
- Settings page fully localized (English / Chinese).

### Changed
- Reply rendering avoids duplicates (trim-based de-dup) and doesn't truncate long replies.
- Approval/question answer must be submitted as one batch covering all questions.
- Relay filters mux frames inside the node child (only approval/question, tool calls,
  reasoning chunks, and errors cross stdout — >98% reduction in churn).

### Fixed
- Approval/question card previously blocked message rendering/queueing forever if it was
  left open (now derives the frozen state from the actual open-card count).
- Copy button no longer overlaps text (anchored beside the bubble); code-block background
  uses the theme's `--code-background` instead of the accent color.
- Auto-collapsing of the history panel no longer fires when using the right-click
  archive/fork menu.

[0.2.0]: https://github.com/Junius-Q/dsh-for-obsidian/releases/tag/0.2.0

## [0.1.0] - 2026-08-14

### Added
- Chat panel with a resident local `dsh --profile web` HTTP service (JSON-RPC-style
  API, streaming replies polled from `session.history`).
- Web-style composer: send/stop button, model / permission / reasoning dropdowns,
  context-usage ring, status bar.
- Session history (list, rename, archive, fork via right-click).
- DeepSeek API key configuration (chat panel ⚙ menu and plugin settings), written
  to dsh's own `~/.dsh/.credentials.yaml` and shared with the CLI / web UI.
- Note commands: Summarize / Translate / Rewrite with configurable write-back.
- Bilingual UI (English / Chinese) following the Obsidian app language.
- Headless fallback when the HTTP service cannot start.
- Auto-prompt to configure the API key when none is set on panel open.

### Changed
- (Initial release — carries the Phase 2 HTTP upgrade from the prior commit.)

[0.1.0]: https://github.com/Junius-Q/dsh-for-obsidian/releases/tag/0.1.0
