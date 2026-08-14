import {
  App,
  Plugin,
  PluginManifest,
  WorkspaceLeaf,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  ObsidianDshSettings,
  ObsidianDshSettingTab,
} from "./settings";
import { DshBridge } from "./bridge/dshCli";
import { PromptBuilder } from "./bridge/promptBuilder";
import { DshHostManager } from "./bridge/dshHost";
import { DshHttpClient } from "./bridge/dshHttp";
import { obsidianJsonPoster } from "./bridge/obsidianFetch";
import { ChatView, VIEW_TYPE_CHAT } from "./panel/ChatView";
import { NoteCommands } from "./commands/NoteCommands";

/**
 * dsh for Obsidian — a Claudian-style local AI agent for your vault.
 * Phase 2: integrates with a resident `dsh --profile web` HTTP service.
 */
export default class ObsidianDsh extends Plugin {
  settings!: ObsidianDshSettings;
  bridge!: DshBridge;
  promptBuilder!: PromptBuilder;
  noteCommands!: NoteCommands;
  hostManager!: DshHostManager;
  http!: DshHttpClient;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    this.bridge = new DshBridge(() => this.settings);
    this.promptBuilder = new PromptBuilder(this.app, () => this.settings);
    this.noteCommands = new NoteCommands(this.app, this);

    // Phase 2 HTTP layer (lazily spawned on first chat use).
    this.hostManager = new DshHostManager(() => this.settings);
    // Use Obsidian's requestUrl (bypasses renderer CSP); plain fetch fails with
    // "Failed to fetch" inside Obsidian.
    this.http = new DshHttpClient(
      this.hostManager,
      () => this.settings,
      this.settings.timeoutMs,
      obsidianJsonPoster
    );

    // Chat view
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("bot", "Open dsh Chat", () => {
      void this.openChatView();
    });
    this.addCommand({
      id: "open-dsh-chat",
      name: "Open dsh Chat",
      callback: () => void this.openChatView(),
    });

    // Note commands
    this.addCommand({
      id: "dsh-summarize",
      name: "dsh: Summarize selection",
      callback: () => void this.noteCommands.run("Summarize"),
    });
    this.addCommand({
      id: "dsh-translate",
      name: "dsh: Translate selection to English",
      // This command prompts nothing; translate defaults to English via extra.
      callback: () => void this.noteCommands.run("Translate", "Translate into English."),
    });
    this.addCommand({
      id: "dsh-rewrite",
      name: "dsh: Rewrite selection",
      callback: () => void this.noteCommands.run("Rewrite"),
    });

    // Settings
    this.addSettingTab(new ObsidianDshSettingTab(this.app, this));
  }

  onunload(): void {
    this.bridge.abortAll();
    this.hostManager?.stop();
  }

  async openChatView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    for (const l of workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
      leaf = l;
      break;
    }
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    // Merge so we never wipe the persisted chatSessions key.
    const data = ((await this.loadData()) as Record<string, unknown>) || {};
    const sessions = data.chatSessions;
    const merged: Record<string, unknown> = { ...this.settings };
    if (sessions !== undefined) merged.chatSessions = sessions;
    await this.saveData(merged);
  }

  /** Load persisted chat sessions (array of serialized sessions). */
  async loadSessions<T>(): Promise<T[]> {
    const raw = (await this.loadData()) as Record<string, unknown> | null;
    const arr = raw && raw.chatSessions ? (raw.chatSessions as T[]) : [];
    return Array.isArray(arr) ? arr : [];
  }

  /** Persist chat sessions under a dedicated key (kept separate from settings). */
  async saveSessions<T>(sessions: T[]): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown>) || {};
    data.chatSessions = sessions;
    await this.saveData(data);
  }
}
