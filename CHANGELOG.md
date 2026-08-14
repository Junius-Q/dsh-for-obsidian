# Changelog

All notable changes to **dsh for Obsidian** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
