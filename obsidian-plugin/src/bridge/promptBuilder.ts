import { App, MarkdownView } from "obsidian";
import type { ObsidianDshSettings } from "../settings";

/**
 * Build the prompt sent to dsh, combining the user message with optional
 * active-note context and targeted-operation instructions.
 */
export class PromptBuilder {
  constructor(
    private app: App,
    private getSettings: () => ObsidianDshSettings
  ) {}

  /**
   * Build a chat prompt. If includeActiveNote is on and there is a readable
   * active markdown file, its content is attached as context.
   */
  async buildChat(userMessage: string): Promise<string> {
    const settings = this.getSettings();
    const parts: string[] = [];

    if (settings.includeActiveNote) {
      const ctx = await this.readActiveNote(settings.contextLimitChars);
      if (ctx) {
        parts.push(
          `[Active note: ${ctx.name}]` +
            `\n\`\`\`note\n${ctx.content}\n\`\`\`\n`
        );
      }
    }

    parts.push(userMessage.trim());
    return parts.join("\n\n");
  }

  /**
   * Build a targeted-operation prompt (summarize / translate / rewrite).
   */
  buildCommand(verb: string, selection: string, extra = ""): string {
    const parts: string[] = [];
    parts.push(`Please ${verb.toLowerCase()} the following text.`);
    if (extra.trim()) parts.push(extra.trim());
    parts.push("Return only the result, in the same language as the source text.");
    parts.push("```input\n" + selection.trim() + "\n```");
    return parts.join("\n\n");
  }

  /**
   * Read the active note content (up to `limit` chars) to attach as context.
   * Must be called before building a chat prompt that references it.
   */
  async readActiveNote(limit: number): Promise<{ name: string; content: string } | null> {
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return null;
      const data = await this.app.vault.cachedRead(view.file);
      if (!data) return null;
      return { name: view.file.name ?? "note", content: data.slice(0, limit) };
    } catch {
      return null;
    }
  }
}
