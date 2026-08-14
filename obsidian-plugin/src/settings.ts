import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ObsidianDsh from "./main";
import { t } from "./i18n";

export interface ObsidianDshSettings {
  /** dsh executable name or absolute path. */
  dshExecutable: string;
  /** dsh profile to boot (only headless is used in Phase 1). */
  profile: string;
  /** Working directory for the spawned dsh process. Defaults to vault root. */
  workingDir: string;
  /** Automatically attach the active note content to chat prompts. */
  includeActiveNote: boolean;
  /** Max characters of note context to attach. */
  contextLimitChars: number;
  /** Default write-back mode for command results. */
  defaultWriteMode: "append" | "overwrite_selection" | "insert_cursor" | "new_note";
  /** Timeout (ms) for a single headless call. */
  timeoutMs: number;
}

export const DEFAULT_SETTINGS: ObsidianDshSettings = {
  dshExecutable: "dsh",
  profile: "headless",
  workingDir: "",
  includeActiveNote: true,
  contextLimitChars: 8000,
  defaultWriteMode: "append",
  timeoutMs: 120000,
};

export class ObsidianDshSettingTab extends PluginSettingTab {
  plugin: ObsidianDsh;

  constructor(app: App, plugin: ObsidianDsh) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "dsh for Obsidian — Settings" });

    new Setting(containerEl)
      .setName("dsh executable")
      .setDesc(
        "Command or absolute path to the dsh CLI. Defaults to `dsh`. Install it with: npm i -g @deepseek-ai/dsh"
      )
      .addText((text) =>
        text
          .setPlaceholder("dsh")
          .setValue(this.plugin.settings.dshExecutable)
          .onChange(async (value) => {
            this.plugin.settings.dshExecutable = value.trim() || "dsh";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("dsh profile")
      .setDesc("Profile to boot. Phase 1 uses the headless profile.")
      .addText((text) =>
        text
          .setPlaceholder("headless")
          .setValue(this.plugin.settings.profile)
          .onChange(async (value) => {
            this.plugin.settings.profile = value.trim() || "headless";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc(
        "Directory dsh works in. Leave empty to use the vault root."
      )
      .addText((text) =>
        text
          .setPlaceholder("(vault root)")
          .setValue(this.plugin.settings.workingDir)
          .onChange(async (value) => {
            this.plugin.settings.workingDir = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include active note")
      .setDesc("Automatically attach the active note's content to chat prompts.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeActiveNote)
          .onChange(async (value) => {
            this.plugin.settings.includeActiveNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Context limit (chars)")
      .setDesc("Maximum characters of note context attached to a prompt.")
      .addText((text) =>
        text
          .setPlaceholder("8000")
          .setValue(String(this.plugin.settings.contextLimitChars))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.contextLimitChars = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default write-back")
      .setDesc("Where command results (e.g. Summarize) are written by default.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("append", "Append to note")
          .addOption("overwrite_selection", "Overwrite selection")
          .addOption("insert_cursor", "Insert at cursor")
          .addOption("new_note", "New note")
          .setValue(this.plugin.settings.defaultWriteMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultWriteMode = value as ObsidianDshSettings["defaultWriteMode"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Timeout (ms)")
      .setDesc("Maximum wait for a single dsh call before aborting.")
      .addText((text) =>
        text
          .setPlaceholder("120000")
          .setValue(String(this.plugin.settings.timeoutMs))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.timeoutMs = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName(t("testConnection"))
      .setDesc(t("testConnectionDesc"))
      .addButton((button) =>
        button.setButtonText(t("runTest")).onClick(async () => {
          button.setDisabled(true);
          button.setButtonText(t("running"));
          try {
            const result = await this.plugin.bridge.run(`${t("replyPrefix")} OK`);
            new Notice(`${t("dshOk")}: ${(result.output || t("noOutput")).slice(0, 120)}`);
          } catch (err) {
            new Notice(`${t("dshTestFailed")}: ${(err as Error).message.slice(0, 200)}`);
          } finally {
            button.setDisabled(false);
            button.setButtonText(t("runTest"));
          }
        })
      );
  }
}
