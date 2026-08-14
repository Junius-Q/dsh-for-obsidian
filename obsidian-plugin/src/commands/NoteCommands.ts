import { App, Editor, MarkdownView, Notice, TFile } from "obsidian";
import type ObsidianDsh from "../main";

type WriteMode = "append" | "overwrite_selection" | "insert_cursor" | "new_note";

/**
 * Targeted note commands (Summarize / Translate / Rewrite) backed by dsh.
 * Result write-back follows the plugin's defaultWriteMode setting.
 */
export class NoteCommands {
  constructor(
    private app: App,
    private plugin: ObsidianDsh
  ) {}

  /** Run a targeted operation on the current editor selection. */
  async run(verb: string, extra = ""): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) {
      new Notice("Open a markdown note and select some text first.");
      return;
    }

    const selection = editor.getSelection();
    if (!selection || !selection.trim()) {
      new Notice("Select some text to process.");
      return;
    }

    const prompt = this.plugin.promptBuilder.buildCommand(verb, selection, extra);
    new Notice(`${verb} running…`);

    try {
      const result = await this.plugin.bridge.run(prompt);
      const out = result.output || result.stderr || "(dsh returned no text)";
      await this.writeResult(view.file, editor, out, this.plugin.settings.defaultWriteMode);
      new Notice(`${verb} done.`);
    } catch (err) {
      new Notice(`${verb} failed: ${(err as Error).message}`);
    }
  }

  /** Write the result back to the vault per the chosen mode. */
  async writeResult(
    file: TFile | null,
    editor: Editor,
    result: string,
    mode: WriteMode
  ): Promise<void> {
    switch (mode) {
      case "overwrite_selection": {
        editor.replaceSelection(result);
        break;
      }
      case "insert_cursor": {
        editor.replaceSelection(editor.getSelection() + "\n\n" + result);
        break;
      }
      case "append": {
        if (file) {
          const original = await this.app.vault.read(file);
          await this.app.vault.modify(file, original.replace(/\s*$/, "") + "\n\n" + result + "\n");
        } else {
          editor.replaceSelection(editor.getSelection() + "\n\n" + result);
        }
        break;
      }
      case "new_note": {
        const base = file ? (file.basename ?? "note") : "note";
        const abs = await this.ensureUniqueVaultPath(`${base}-dsh.md`, this.app);
        await this.app.vault.create(abs, result);
        const tfile = this.app.vault.getAbstractFileByPath(abs);
        if (tfile instanceof TFile) {
          await this.app.workspace.getLeaf(true).openFile(tfile);
        }
        break;
      }
    }
  }

  private async ensureUniqueVaultPath(name: string, app: App): Promise<string> {
    let path = name;
    let i = 1;
    while (app.vault.getAbstractFileByPath(path)) {
      const dot = name.indexOf(".");
      const stem = dot === -1 ? name : name.slice(0, dot);
      const ext = dot === -1 ? "" : name.slice(dot);
      path = `${stem}-dsh-${i}${ext}`;
      i++;
    }
    return path;
  }
}
