import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, Modal, Setting, App } from "obsidian";
import type ObsidianDsh from "../main";
import { DshStreamClient } from "../bridge/dshStream";
import { t } from "../i18n";

export const VIEW_TYPE_CHAT = "obsidian-dsh-chat";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface ChatSession {
  id: string;
  title: string;
  source: string;
  messages: ChatMessage[];
  createdAt: number;
}

/**
 * Single-panel chat view. Phase 2: streams replies from a resident dsh HTTP
 * service (true per-token streaming, session grouping by vault cwd), with
 * headless fallback if the HTTP service cannot start.
 */
export class ChatView extends ItemView {
  private rootEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private messagesEl!: HTMLElement;
  private historyPanelEl!: HTMLElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private attachCtl!: HTMLInputElement;
  private modelBtn!: HTMLButtonElement;
  private busy = false;
  private stopped = false;
  private sessions: ChatSession[];
  private activeId: string;
  private dshSessionId: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: ObsidianDsh
  ) {
    super(leaf);
    this.sessions = [];
    this.activeId = this.newId();
  }

  /** Cache stats for the last completed turn, shown under the reply. */
  private lastCacheStats: { rate: number; label: string } | null = null;
  private currentModel: string | null = null;

  /** Sync current model from a session.models response. */
  private setModelFrom(self: { current?: { provider?: string; model?: string } }) {
    if (self && self.current) {
      const m = self.current.model;
      const p = self.current.provider;
      this.currentModel = m ? (p ? `${p}:${m}` : m) : null;
    }
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return t("chattingWithDsh");
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    try {
      this.sessions = (await this.plugin.loadSessions<ChatSession>()).map((s) => ({
        ...s,
        source: s.source || "obsidian",
      }));
    } catch {
      this.sessions = [];
    }
    if (this.sessions.length > 0) this.activeId = this.sessions[0].id;

    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("obsidian-dsh-chat");
    this.rootEl = root;

    this.renderHeader();
    this.renderHistoryPanel();
    this.renderMessages();
    this.renderComposer();
    this.ensureSession();
    void this.ensureHttpSession();
  }

  async onClose(): Promise<void> {
    this.plugin.bridge.abortAll();
    await this.persist();
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  private renderHeader(): void {
    const header = this.rootEl.createDiv({ cls: "obdsh-toolbar" });

    const brand = header.createDiv({ cls: "obdsh-toolbar-brand" });
    brand.createEl("span", { cls: "obdsh-brand-mark", text: "❍" });
    brand.createEl("span", { cls: "obdsh-brand-title", text: t("appName") });
    brand.createEl("span", { cls: "obdsh-brand-sub", text: t("appSubtitle") });

    // Model selector (Phase 2)
    const modelBtn = header.createEl("button", {
      cls: "obdsh-model-btn",
      attr: { title: t("modelSwitch") },
    });
    modelBtn.setText(this.currentModel || "…");
    modelBtn.addEventListener("click", (e) => this.openModelMenu(modelBtn, e));
    const modelBtnEl = modelBtn; // keep reference for refresh
    this.modelBtn = modelBtnEl;

    const historyBtn = header.createEl("button", {
      cls: "obdsh-icon-btn obdsh-history-toggle",
      attr: { title: t("conversations"), "aria-label": t("conversations") },
    });
    historyBtn.createEl("span", { text: "☰" });
    historyBtn.addEventListener("click", () => this.toggleHistory());

    const clearBtn = header.createEl("button", {
      cls: "obdsh-icon-btn obdsh-clear-btn",
      attr: { title: t("newSession"), "aria-label": t("newSession") },
    });
    clearBtn.createEl("span", { text: "＋" });
    clearBtn.addEventListener("click", () => this.newSession());
  }

  private renderHistoryPanel(): void {
    this.historyPanelEl = this.rootEl.createDiv({ cls: "obdsh-history" });
    this.historyPanelEl.hidden = true;
  }

  private renderMessages(): void {
    if (!this.messagesEl) this.messagesEl = this.rootEl.createDiv({ cls: "obdsh-messages" });
    else this.messagesEl.empty();

    const s = this.active();
    if (!s || s.messages.length === 0) {
      this.messagesEl.empty();
      this.showHint(t("welcomeHint"));
      return;
    }
    for (const m of s.messages) this.appendMessageReplay(m.role, m.text);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private renderComposer(): void {
    const composer = this.rootEl.createDiv({ cls: "obdsh-composer" });

    const attachRow = composer.createDiv({ cls: "obdsh-composer-attach" });
    this.attachCtl = attachRow.createEl("input", { type: "checkbox" });
    this.attachCtl.id = "obdsh-attach-toggle";
    this.attachCtl.checked = this.plugin.settings.includeActiveNote;
    const label = attachRow.createEl("label", { attr: { for: "obdsh-attach-toggle" } });
    label.createEl("span", { text: t("attachNote") });
    this.attachCtl.addEventListener("change", (e) => {
      this.plugin.settings.includeActiveNote = (e.target as HTMLInputElement).checked;
      void this.plugin.saveSettings();
    });

    this.inputEl = composer.createEl("textarea", {
      cls: "obdsh-input",
      attr: { placeholder: t("inputPlaceholder"), rows: "3" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    const actions = composer.createDiv({ cls: "obdsh-composer-actions" });
    this.stopBtn = actions.createEl("button", {
      cls: "obdsh-btn obdsh-btn-ghost obdsh-stop",
      text: t("stop"),
    });
    this.stopBtn.addEventListener("click", () => this.onStop());
    this.stopBtn.hidden = true;

    this.sendBtn = actions.createEl("button", {
      cls: "obdsh-btn obdsh-btn-primary obdsh-send",
      text: t("send"),
    });
    this.sendBtn.addEventListener("click", () => void this.send());
  }

  // ------------------------------------------------------------------
  // HTTP session setup
  // ------------------------------------------------------------------
  private sessionCwd(): string | undefined {
    try {
      // DataAdapter exposes getBasePath() in the Electron runtime, though the
      // ambient types omit it; cast to access.
      const adapter = this.plugin.app.vault.adapter as unknown as { getBasePath?: () => string };
      return (typeof adapter.getBasePath === "function" ? adapter.getBasePath() : undefined) || undefined;
    } catch {
      return undefined;
    }
  }

  private async ensureHttpSession(): Promise<void> {
    try {
      await this.plugin.http.connect();
      const list = (await this.plugin.http.listSessions()) as {
        items?: Array<{ sessionId: string; cwd?: string }>;
      };
      const cwd = this.sessionCwd();
      const existing = list.items?.find((s) => s && s.cwd === cwd);
      if (existing) {
        this.dshSessionId = existing.sessionId;
      } else {
        const created = (await this.plugin.http.createSession(
          cwd ? { cwd } : {}
        )) as unknown as { sessionId: string };
        this.dshSessionId = created.sessionId;
      }
      void this.refreshModel();
    } catch (e) {
      this.dshSessionId = null;
      void new Notice(`dsh HTTP unavailable → headless: ${(e as Error).message.slice(0, 60)}`);
    }
  }

  /** Fetch the current model for the bound dsh session and update the header. */
  private async refreshModel(): Promise<void> {
    if (!this.dshSessionId) return;
    try {
      const m = (await this.plugin.http.models(this.dshSessionId)) as unknown as {
        current?: { provider?: string; model?: string };
      };
      this.setModelFrom(m);
      if (this.modelBtn) this.modelBtn.setText(this.modelNameShort());
    } catch {
      /* ignore */
    }
  }

  private modelNameShort(): string {
    if (!this.currentModel) return "…";
    // e.g. "deepseek-v4-flash"
    const idx = this.currentModel.indexOf(":");
    return idx >= 0 ? this.currentModel.slice(idx + 1) : this.currentModel;
  }

  /** Open a modal listing available models for the active session. */
  private openModelMenu(btn: HTMLButtonElement, ev: MouseEvent): void {
    void btn;
    void ev;
    if (!this.dshSessionId) {
      new Notice("Connect dsh HTTP first (start a chat).");
      return;
    }
    const sid = this.dshSessionId;
    const dlg = new ModelPickerModal(this.app, async () => {
      const cat = (await this.plugin.http.models(sid)) as unknown as ModelsCatalog;
      return cat;
    }, (provider, model) => void this.doSelectModel(provider, model));
    dlg.open();
  }

  private async doSelectModel(provider: string, model: string): Promise<void> {
    if (!this.dshSessionId) return;
    try {
      const sel = (await this.plugin.http.selectModel(this.dshSessionId, provider, model)) as {
        selected?: { provider?: string; model?: string };
      };
      const cur = (sel.selected || {}) as { provider?: string; model?: string };
      this.setModelFrom({ current: cur });
      if (this.modelBtn) this.modelBtn.setText(this.modelNameShort());
      new Notice(`Model → ${this.modelNameShort()}`);
    } catch (e) {
      new Notice(`Model change failed: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  // ------------------------------------------------------------------
  // Session management
  // ------------------------------------------------------------------
  private newId(): string {
    return "s-" + Math.random().toString(36).slice(2, 10);
  }

  private ensureSession(): void {
    if (!this.sessions.find((s) => s.id === this.activeId)) {
      this.sessions.unshift({
        id: this.activeId,
        title: t("newChat"),
        source: "obsidian",
        messages: [],
        createdAt: Date.now(),
      });
      this.rebuildHistoryList();
      if (this.messagesEl) this.showHint(t("welcomeHint"));
      return;
    }
    this.rebuildHistoryList();
  }

  private persist(): Promise<void> {
    return this.plugin.saveSessions(this.sessions);
  }

  private active(): ChatSession {
    return this.sessions.find((s) => s.id === this.activeId)!;
  }

  private newSession(): void {
    this.plugin.bridge.abortAll();
    this.activeId = this.newId();
    this.ensureSession();
    this.renderMessages();
    this.showHint(t("newConversationStarted"));
  }

  private selectSession(id: string): void {
    this.plugin.bridge.abortAll();
    this.activeId = id;
    this.ensureSession();
    this.renderMessages();
  }

  private toggleHistory(): void {
    this.historyPanelEl.hidden = !this.historyPanelEl.hidden;
    if (!this.historyPanelEl.hidden) this.rebuildHistoryList();
  }

  private rebuildHistoryList(): void {
    this.historyPanelEl.empty();
    if (this.sessions.length === 0) {
      this.historyPanelEl.createEl("div", {
        cls: "obdsh-history-empty",
        text: t("noConversations"),
      });
      return;
    }
    for (const s of this.sessions) {
      const item = this.historyPanelEl.createDiv({
        cls: "obdsh-history-item" + (s.id === this.activeId ? " is-active" : ""),
      });
      item.createEl("span", { cls: "obdsh-history-item-title", text: s.title });
      item.createEl("span", {
        cls: "obdsh-history-item-count",
        text: `${s.messages.length} msg`,
      });
      item.addEventListener("click", () => this.selectSession(s.id));
    }
  }

  private updateActiveSession(role: "user" | "assistant", text: string): void {
    const s = this.active();
    s.messages.push({ role, text });
    if (s.messages.length === 1) {
      s.title = s.messages[0].text.replace(/\s+/g, " ").slice(0, 40) || t("newChat");
    }
  }

  // ------------------------------------------------------------------
  // Messaging
  // ------------------------------------------------------------------
  private async send(): Promise<void> {
    if (this.busy) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = "";
    this.updateActiveSession("user", text);
    this.appendMessage("user", text);
    this.busy = true;
    this.stopped = false;
    this.sendBtn.hidden = true;
    this.stopBtn.hidden = false;

    const { body } = this.appendTyping();

    try {
      if (this.dshSessionId) {
        await this.streamFromDsh(this.dshSessionId, text, body);
      } else {
        const prompt = await this.plugin.promptBuilder.buildChat(text);
        const result = await this.plugin.bridge.run(prompt);
        const final = result.output || t("noOutput");
        this.updateActiveSession("assistant", final);
        await this.renderMarkdown(body, final);
      }
    } catch (err) {
      const msg = `**${t("errorPrefix")}:** ${(err as Error).message}`;
      this.updateActiveSession("assistant", msg);
      await this.renderMarkdown(body, msg);
    } finally {
      this.busy = false;
      this.sendBtn.hidden = false;
      this.stopBtn.hidden = true;
      this.inputEl.focus();
      this.rebuildHistoryList();
      void this.persist();
    }
  }

  private async streamFromDsh(sessionId: string, text: string, body: HTMLElement): Promise<void> {
    let acc = "";
    let settled = false;
    let finalResolve!: (v: string) => void;
    const donePromise = new Promise<string>((r) => (finalResolve = r));

    await this.plugin.hostManager.ensureStarted();
    let usageTokens: { input?: number; cacheRead?: number; cacheWrite?: number } | null = null;
    const stream = new DshStreamClient(this.plugin.hostManager, {
      onEvent: (chunk) => {
        if (this.stopped) return;
        if (chunk.delta) {
          acc += chunk.delta;
          body.empty();
          body.createEl("span", { text: acc, cls: "obdsh-stream-text" });
          this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }
        if (chunk.usage) {
          usageTokens = {
            input: chunk.usage.inputTokens,
            cacheRead: chunk.usage.cacheReadTokens,
            cacheWrite: chunk.usage.cacheWriteTokens,
          };
        }
        if (chunk.kind === "assistant/message" || chunk.kind === "chunk-end") {
          settled = true;
          finalResolve!(acc);
        }
      },
      onError: (e) => {
        if (!settled) {
          settled = true;
          finalResolve!(acc || "");
          void new Notice(`dsh stream error: ${e.message.slice(0, 60)}`);
        }
      },
    });

    let finalText = "";
    try {
      await stream.open(10000);
      await this.plugin.http.prompt(sessionId, text);
      const timeout = new Promise<string>((r) => setTimeout(() => r(acc), 120000));
      finalText = await Promise.race([donePromise, timeout]);
    } catch (e) {
      // WebSocket failed (e.g. blocked in Obsidian renderer) — fall back to
      // polling session.history for the final assistant reply.
      finalText = acc || (await this.fetchLastAssistant(sessionId)) || "";
      if (!finalText) {
        void new Notice(`dsh stream unavailable: ${(e as Error).message.slice(0, 60)}`);
      }
    } finally {
      stream.close();
    }

    if (!this.stopped) {
      const final = finalText || t("noOutput");
      this.updateActiveSession("assistant", final);
      await this.renderMarkdown(body, final);
      if (usageTokens) this.appendCacheStats(body, usageTokens);
    }
  }

  /** Pull the most recent assistant text from session.history as a fallback. */
  private async fetchLastAssistant(sessionId: string): Promise<string> {
    try {
      const h = (await this.plugin.http.history(sessionId, 40)) as {
        events?: Array<{ event?: { type?: string; data?: { message?: unknown } } }>;
      };
      const events = h?.events || [];
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]?.event;
        if (ev?.type !== "assistant/message") continue;
        const content = (ev.data?.message as { content?: unknown[] } | undefined)?.content;
        if (Array.isArray(content)) {
          const text = content
            .map((c) => (c as { type?: string; text?: string }).text || "")
            .join("");
          if (text.trim()) return text;
        }
      }
      return "";
    } catch {
      return "";
    }
  }

  /** Add a small cache-hit line under the rendered reply. */
  private appendCacheStats(
    body: HTMLElement,
    u: { input?: number; cacheRead?: number; cacheWrite?: number }
  ): void {
    const total = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
    if (total <= 0) return;
    const rate = Math.round(((u.cacheRead || 0) / total) * 100);
    const line = body.createDiv({ cls: "obdsh-cache-stats" });
    line.setText(
      `⚡ ${rate}% cache hit · ${(u.cacheRead || 0).toLocaleString()} read / ${(u.cacheWrite || 0).toLocaleString()} write / ${(u.input || 0).toLocaleString()} input`
    );
    this.lastCacheStats = { rate, label: line.textContent || "" };
  }

  private onStop(): void {
    this.stopped = true;
    this.plugin.bridge.abortAll();
  }

  private appendMessage(role: "user" | "assistant", text: string): HTMLElement {
    const row = this.messagesEl.createDiv({ cls: `obdsh-msg obdsh-msg-${role}` });
    const avatar = row.createDiv({
      cls: "obdsh-avatar" + (role === "assistant" ? " obdsh-avatar-ai" : " obdsh-avatar-user"),
    });
    avatar.setText(role === "assistant" ? "❍" : "你");
    const bubble = row.createDiv({ cls: "obdsh-bubble" });
    if (role === "user") bubble.setText(text);
    else void this.renderMarkdown(bubble, text);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return bubble;
  }

  private appendMessageReplay(role: "user" | "assistant", text: string): void {
    const row = this.messagesEl.createDiv({ cls: `obdsh-msg obdsh-msg-${role}` });
    const avatar = row.createDiv({
      cls: "obdsh-avatar" + (role === "assistant" ? " obdsh-avatar-ai" : " obdsh-avatar-user"),
    });
    avatar.setText(role === "assistant" ? "❍" : "你");
    const bubble = row.createDiv({ cls: "obdsh-bubble" });
    if (role === "user") bubble.setText(text);
    else void this.renderMarkdown(bubble, text);
  }

  private appendTyping(): { body: HTMLElement } {
    const row = this.messagesEl.createDiv({ cls: "obdsh-msg obdsh-msg-assistant" });
    const avatar = row.createDiv({ cls: "obdsh-avatar obdsh-avatar-ai" });
    avatar.setText("❍");
    const bubble = row.createDiv({ cls: "obdsh-bubble obdsh-typing" });
    for (let i = 0; i < 3; i++) bubble.createSpan({ cls: "obdsh-typing-dot" });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return { body: bubble };
  }

  private showHint(text: string): void {
    this.messagesEl.empty();
    const hint = this.messagesEl.createDiv({ cls: "obdsh-hint" });
    hint.createEl("span", { text });
  }

  private async renderMarkdown(el: HTMLElement, md: string): Promise<void> {
    await MarkdownRenderer.render(this.app, md, el, "", this);
  }
}

/** Shape of the session.models response (relevant subset). */
interface ModelsCatalog {
  current?: { provider?: string; model?: string };
  groups?: Array<{ id: string; name?: string; models?: Array<{ id: string; name?: string }> }>;
}

/** A modal that lists the available dsh models and lets the user pick one. */
class ModelPickerModal extends Modal {
  constructor(
    app: App,
    private load: () => Promise<ModelsCatalog>,
    private onPick: (provider: string, model: string) => void
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Switch model" });
    const status = contentEl.createDiv({ cls: "obdsh-model-list-status", text: "Loading…" });

    try {
      const cat = await this.load();
      status.setText("");
      contentEl.empty();
      if (!cat.groups || cat.groups.length === 0) {
        contentEl.createEl("div", { text: "No models available." });
        return;
      }
      for (const g of cat.groups) {
        contentEl.createEl("h4", { text: g.name || g.id });
        for (const m of g.models || []) {
          const row = contentEl.createDiv({ cls: "obdsh-model-row" });
          row.createEl("span", { text: m.name || m.id, cls: "obdsh-model-name" });
          const btn = row.createEl("button", {
            cls: "obdsh-btn obdsh-btn-ghost",
            text: "Use",
          });
          btn.addEventListener("click", () => {
            this.onPick(g.id, m.id);
            this.close();
          });
        }
      }
    } catch (e) {
      status.setText(`Error: ${(e as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
