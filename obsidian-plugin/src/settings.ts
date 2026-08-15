import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type ObsidianDsh from "./main";
import { t } from "./i18n";
import { credentialsPath, isKeyConfigured, setStoredKey } from "./bridge/dshConfig";

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
  /** Fixed loopback port for the resident dsh web host (0 = random). Reused across reloads. */
  httpPort: number;
  /** Whether to kill the dsh web process we spawned when the plugin unloads. */
  killWebOnUnload: boolean;
}

export const DEFAULT_SETTINGS: ObsidianDshSettings = {
  dshExecutable: "dsh",
  profile: "headless",
  workingDir: "",
  includeActiveNote: true,
  contextLimitChars: 8000,
  defaultWriteMode: "append",
  timeoutMs: 120000,
  httpPort: 3080,
  killWebOnUnload: true,
};

export class ObsidianDshSettingTab extends PluginSettingTab {
  plugin: ObsidianDsh;

  constructor(app: App, plugin: ObsidianDsh) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Resolve the currently open vault's absolute path (for display). */
  private currentVaultPath(): string {
    try {
      const adapter = this.app.vault.adapter as unknown as { getBasePath?: () => string };
      const p = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : undefined;
      return p ? `\`${p}\`` : "(unavailable)";
    } catch {
      return "(unavailable)";
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: t("settingsTitle") });

    // DeepSeek API key — written to dsh's own ~/.dsh/.credentials.yaml so it
    // works everywhere (plugin, CLI, web) with one entry.
    containerEl.createEl("h3", {
      text: isKeyConfigured()
        ? `${t("keyConfiguredPrefix")}（${t("keyConfigured")}）`
        : t("keyConfiguredPrefix"),
    });
    const keyDesc = isKeyConfigured() ? t("keyDescConfigured") : t("keyDescNotConfigured");
    const keyStatus = containerEl.createEl("div", {
      text: isKeyConfigured() ? `✓ ${t("keyConfigured")}` : `○ ${t("keyNotConfigured")}`,
      cls: "setting-item-description",
    });
    void keyStatus;
    new Setting(containerEl)
      .setName(t("keyConfiguredPrefix"))
      .setDesc(keyDesc)
      .addText((text) => text.setPlaceholder("sk-…").inputEl.setAttribute("type", "password"))
      .addButton((btn) =>
        btn.setButtonText(t("save")).onClick(async () => {
          const comp = btn.buttonEl.closest(".setting-item")?.querySelector("input");
          const val = (comp as HTMLInputElement | null)?.value?.trim() ?? "";
          if (!val) {
            new Notice(t("keyEmptyNotice"));
            return;
          }
          const saved = setStoredKey(val);
          new Notice(saved ? t("keySavedNotice") : t("keySaveFailedNotice"));
          if (keyStatus)
            keyStatus.textContent = saved ? `✓ ${t("keyConfigured")}` : `○ ${t("keySaveFailedNotice")}`;
        })
      )
      .addButton((btn) =>
        btn.setButtonText(t("clear")).onClick(() => {
          new ConfirmModal(this.app, t("keyClearConfirmMsg"), () => {
            const cleared = setStoredKey(null);
            new Notice(cleared ? t("keyCleared") : t("keyClearFailed"));
            if (keyStatus) keyStatus.textContent = `○ ${t("keyNotConfigured")}`;
          }).open();
        })
      );

    new Setting(containerEl)
      .setName(t("keyLocation"))
      .setDesc(`${t("keyLocationDesc")}\`${credentialsPath()}\``);

    new Setting(containerEl)
      .setName(t("stExecutable"))
      .setDesc(t("stExecutableDesc"))
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
      .setName(t("stProfile"))
      .setDesc(t("stProfileDesc"))
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
      .setName(t("stWorkingDir"))
      .setDesc(`${t("stWorkingDirDesc")} ${this.currentVaultPath()}`)
      .addText((text) =>
        text
          .setPlaceholder(t("stWorkingDirPlaceholder"))
          .setValue(this.plugin.settings.workingDir)
          .onChange(async (value) => {
            this.plugin.settings.workingDir = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("stIncludeNote"))
      .setDesc(t("stIncludeNoteDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeActiveNote)
          .onChange(async (value) => {
            this.plugin.settings.includeActiveNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("stContextLimit"))
      .setDesc(t("stContextLimitDesc"))
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
      .setName(t("stWriteback"))
      .setDesc(t("stWritebackDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("append", t("wbAppend"))
          .addOption("overwrite_selection", t("wbOverwrite"))
          .addOption("insert_cursor", t("wbInsert"))
          .addOption("new_note", t("wbNewNote"))
          .setValue(this.plugin.settings.defaultWriteMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultWriteMode = value as ObsidianDshSettings["defaultWriteMode"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("stTimeout"))
      .setDesc(t("stTimeoutDesc"))
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
      .setName(t("stPort"))
      .setDesc(t("stPortDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("stPortPlaceholder"))
          .setValue(String(this.plugin.settings.httpPort))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            this.plugin.settings.httpPort = !isNaN(n) && n >= 0 ? n : 0;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("stKillWeb"))
      .setDesc(t("stKillWebDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.killWebOnUnload)
          .onChange(async (value) => {
            this.plugin.settings.killWebOnUnload = value;
            await this.plugin.saveSettings();
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

/** Obsidian-styled confirmation modal (avoids native confirm() in settings). */
class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("confirmTitle") });
    contentEl.createEl("p", { text: this.message });
    const actions = contentEl.createDiv({ cls: "obdsh-prompt-actions" });
    const cancel = actions.createEl("button", { cls: "obdsh-btn obdsh-btn-ghost", text: t("cmdCancel") });
    cancel.addEventListener("click", () => this.close());
    const ok = actions.createEl("button", { cls: "obdsh-btn obdsh-btn-primary", text: t("cmdConfirm") });
    ok.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
