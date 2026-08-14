# Contributing to dsh for Obsidian

Thanks for your interest in contributing! This plugin is a thin shell that drives a
local [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)
agent from inside Obsidian. Issues, bug reports, and pull requests are welcome.

## Getting started

```bash
git clone https://github.com/Junius-Q/dsh-for-obsidian
cd dsh-for-obsidian/obsidian-plugin
npm install
npm run dev        # watch mode (esbuild)
npm run build      # type-check + production bundle
```

## How to test

- **Day-to-day**: open the chat panel and send a message. Replies stream in with
  Markdown formatting; a headless fallback kicks in if the HTTP service can't start.
- **API key**: enter it from the panel's ⚙ menu or the plugin settings. It is written
  to dsh's own `~/.dsh/.credentials.yaml`, so the CLI / web UI share it too.

## Before opening a Pull Request

1. Make sure `npm run build` passes (type-check + production bundle).
2. Keep the change focused and add a clear commit message.
3. Update `README.md` / `README.zh.md` if the change affects usage or setup.
4. For release-worthy changes, update `CHANGELOG.md` under an `[Unreleased]` section.

## Code style notes

- The UI text is localized via `src/i18n.ts` — add keys to both `en` and `zh`.
- Keep `main.js` and `node_modules` out of the repo (they are git-ignored).
- No `console.log` / stray debugging output in committed code.

## Reporting issues

Use the issue templates — include your Obsidian version, `dsh` version
(`dsh --version`), platform, and a short repro so we can help quickly.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
