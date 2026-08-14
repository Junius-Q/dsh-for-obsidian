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

    containerEl.createEl("h2", { text: "dsh for Obsidian — Settings" });

    // DeepSeek API key — written to dsh's own ~/.dsh/.credentials.yaml so it
    // works everywhere (plugin, CLI, web) with one entry.
    containerEl.createEl("h3", {
      text: isKeyConfigured() ? "DeepSeek API Key（已配置）" : "DeepSeek API Key",
    });
    const keyDesc = isKeyConfigured()
      ? "已写入 dsh 配置文件（插件/CLI/web 通用）。输入新值并保存可覆盖；留空可清除。"
      : "未配置。填入 DeepSeek API key 并保存，会写入 dsh 配置文件（插件/CLI/web 通用）。";
    const keyStatus = containerEl.createEl("div", {
      text: isKeyConfigured() ? "✓ 已配置" : "○ 未配置",
      cls: "setting-item-description",
    });
    void keyStatus;
    new Setting(containerEl)
      .setName("DeepSeek API key")
      .setDesc(keyDesc)
      .addText((text) => text.setPlaceholder("sk-…").inputEl.setAttribute("type", "password"))
      .addButton((btn) =>
        btn.setButtonText("保存").onClick(async () => {
          const comp = btn.buttonEl.closest(".setting-item")?.querySelector("input");
          const val = (comp as HTMLInputElement | null)?.value?.trim() ?? "";
          if (!val) {
            new Notice("未输入 key，未做更改（如需清除请使用「清除」）");
            return;
          }
          const saved = setStoredKey(val);
          new Notice(saved ? "已保存到 dsh 配置文件（全局生效）" : "保存失败，请检查配置目录权限");
          if (keyStatus) keyStatus.textContent = saved ? "✓ 已配置" : "○ 保存失败";
        })
      )
      .addButton((btn) =>
        btn.setButtonText("清除").onClick(() => {
          const msg = "清除已保存的 DeepSeek API key？";
          new ConfirmModal(this.app, msg, () => {
            const cleared = setStoredKey(null);
            new Notice(cleared ? "已清除" : "清除失败");
            if (keyStatus) keyStatus.textContent = "○ 未配置";
          }).open();
        })
      );

    new Setting(containerEl)
      .setName("配置位置")
      .setDesc(`Key 写入 dsh 配置文件：\`${credentialsPath()}\``);

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
        "Folder dsh treats as its workspace (where 'workspace-write' applies). Leave empty to follow the CURRENT vault — swapping vaults or machines automatically re-targets it. Currently: " +
          this.currentVaultPath()
      )
      .addText((text) =>
        text
          .setPlaceholder("(follow current vault)")
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
