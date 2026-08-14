import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, Modal, App, Menu } from "obsidian";
import type ObsidianDsh from "../main";
import { CustomDropdown } from "./CustomDropdown";
import { t } from "../i18n";
import { isKeyConfigured, setStoredKey } from "../bridge/dshConfig";

export const VIEW_TYPE_CHAT = "obsidian-dsh-chat";

/** Web-style "send" up-arrow icon (shown on the round corner button when idle). */
const SEND_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V4.5"/><path d="m5 11.5 7-7 7 7"/></svg>';
/** Web-style "stop" square icon (shown when the agent is generating). */
const STOP_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="#fff" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Optional reasoning (thinking) text, shown in a separate collapsible block. */
  reasoning?: string;
}

interface ChatSession {
  id: string;
  title: string;
  source: string;
  messages: ChatMessage[];
  createdAt: number;
  /** dsh-side session id, bound lazily on first send (kept local, not grouped). */
  dshId?: string;
  /** Persisted user preference so model/reasoning survive plugin reloads. */
  preferredModel?: { provider: string; model: string; reasoningEffort?: string };
  preferredPermission?: string;
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
  private attachCtl!: HTMLInputElement;
  private modelSelect!: CustomDropdown;
  private statusEl!: HTMLElement;
  private contextRingEl!: SVGSVGElement;
  private lastContext: { used: number; window: number; pct: number; breakdown?: { system?: number; tools?: number; messages?: number } } | null = null;
  private permSelect!: CustomDropdown;
  private reasoningSelect!: CustomDropdown;
  private cmdBtnEl!: HTMLButtonElement;
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

    // Connect to dsh eagerly on open so model/reasoning/permission populate
    // without a first message. ensureHttpSession reuses any still-valid dsh
    // session, refreshes a stale (restart) one, and degrades to headless on
    // failure.
    void this.ensureHttpSession().then((sid) => {
      if (sid) void this.populateComposerControls();
    });

    // If no DeepSeek key is configured, prompt the user to set one up.
    if (!isKeyConfigured()) {
      setTimeout(() => this.openApiKeyModal(), 400);
    }
  }

  async onClose(): Promise<void> {
    this.plugin.bridge.abortAll();
    this.uninstallHistoryAutoClose();
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

    // Settings gear at the far right — opens "configure API key" / "open web".
    const settingsBtn = header.createEl("button", {
      cls: "obdsh-icon-btn obdsh-settings-btn",
      attr: { title: t("settingsMenu"), "aria-label": t("settingsMenu") },
    });
    settingsBtn.createEl("span", { text: "⚙" });
    settingsBtn.addEventListener("click", (e) => this.openSettingsMenu(e));
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
    for (const m of s.messages) this.appendMessageReplay(m.role, m.text, m.reasoning);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private renderComposer(): void {
    const composer = this.rootEl.createDiv({ cls: "obdsh-composer" });

    // Top row: attach toggle (left) only — ring & model switch live in the
    // bottom bar (web-style).
    const topRow = composer.createDiv({ cls: "obdsh-composer-top" });
    const attachRow = topRow.createDiv({ cls: "obdsh-composer-attach" });
    this.attachCtl = attachRow.createEl("input", { type: "checkbox" });
    this.attachCtl.id = "obdsh-attach-toggle";
    this.attachCtl.checked = this.plugin.settings.includeActiveNote;
    const label = attachRow.createEl("label", { attr: { for: "obdsh-attach-toggle" } });
    label.createEl("span", { text: t("attachNote") });
    this.attachCtl.addEventListener("change", (e) => {
      this.plugin.settings.includeActiveNote = (e.target as HTMLInputElement).checked;
      void this.plugin.saveSettings();
    });

    // Input, with the round send/stop button embedded bottom-right.
    const inputWrap = composer.createDiv({ cls: "obdsh-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "obdsh-input",
      attr: { placeholder: t("inputPlaceholder"), rows: "3" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.onActionClick();
      }
    });
    this.sendBtn = inputWrap.createEl("button", {
      cls: "obdsh-send",
      attr: { type: "button", title: t("send"), "aria-label": t("send") },
    });
    this.sendBtn.innerHTML = SEND_ICON;
    this.sendBtn.addEventListener("click", () => void this.onActionClick());

    // Bottom row: command + permission / reasoning / ring / model (right).
    const bottomRow = composer.createDiv({ cls: "obdsh-composer-bottom" });
    this.cmdBtnEl = bottomRow.createEl("button", {
      cls: "obdsh-icon-btn obdsh-cmd-btn",
      attr: { title: t("commands"), "aria-label": t("commands") },
    });
    this.cmdBtnEl.setText("＋");
    this.cmdBtnEl.addEventListener("click", (e) => void this.openCommandMenu(e));
    this.permSelect = new CustomDropdown(bottomRow, {
      placeholder: t("permission"),
      maxWidth: "150px",
      onChange: (value) => void this.onPermChangeValue(value),
    });
    this.reasoningSelect = new CustomDropdown(bottomRow, {
      placeholder: t("reasoning"),
      maxWidth: "110px",
      onChange: (value) => void this.onReasoningChangeValue(value),
    });

    // Spacer pushes the ring + model to the FAR right edge.
    const spacer = bottomRow.createDiv({ cls: "obdsh-composer-spacer" });
    void spacer;

    this.contextRingEl = this.buildContextRing();
    bottomRow.appendChild(this.contextRingEl);
    this.contextRingEl.classList.add("obdsh-ring-clickable");
    this.contextRingEl.addEventListener("click", (e) => this.showContextInfo(e));
    this.modelSelect = new CustomDropdown(bottomRow, {
      placeholder: t("modelSwitch"),
      maxWidth: "190px",
      onChange: () => void this.onModelSelect(),
    });

    // Status line (stats) — always visible, follows the active session.
    this.statusEl = composer.createDiv({ cls: "obdsh-status" });
    this.setStatusNoData();

    // Populate composer controls (model list, permission options, reasoning)
    void this.populateComposerControls();
  }

  /** Build an SVG circular progress ring for context usage. */
  private buildContextRing(): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const size = 22;
    const c = 9; // radius must fit within viewBox (size/2)
    const circ = 2 * Math.PI * c;
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.classList.add("obdsh-ring");
    const bg = document.createElementNS(ns, "circle");
    bg.setAttribute("cx", String(size / 2));
    bg.setAttribute("cy", String(size / 2));
    bg.setAttribute("r", String(c));
    bg.setAttribute("fill", "none");
    bg.setAttribute("stroke", "var(--background-modifier-border)");
    bg.setAttribute("stroke-width", "3");
    const fg = document.createElementNS(ns, "circle");
    fg.setAttribute("cx", String(size / 2));
    fg.setAttribute("cy", String(size / 2));
    fg.setAttribute("r", String(c));
    fg.setAttribute("fill", "none");
    fg.setAttribute("stroke", "var(--obdsh-brand, #4d6bfe)");
    fg.setAttribute("stroke-width", "3");
    fg.setAttribute("stroke-linecap", "round");
    fg.style.strokeDasharray = String(circ);
    fg.style.strokeDashoffset = String(circ);
    fg.style.transform = "rotate(-90deg)";
    fg.style.transformOrigin = "center";
    fg.dataset.circ = String(circ);
    svg.appendChild(bg);
    svg.appendChild(fg);
    svg.setAttribute("title", "context usage");
    return svg;
  }

  /** Fill model/reasoning/permission controls from dsh, then schedule ring refresh. */
  private async populateComposerControls(): Promise<void> {
    const sid = this.dshSessionId;
    if (!sid) return;
    try {
      const cat = (await this.plugin.http.models(sid)) as unknown as ModelsCatalog;
      this.applyModels(cat);
      void this.applyPreferredModel(cat);
    } catch {
      /* ignore */
    }
    try {
      const h = (await this.plugin.http.history(sid, 2)) as {
        projections?: {
          values?: {
            permissions?: { options?: Array<{ value: string; name: string }>; currentValue?: string };
            contextPressure?: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number };
            sessionStats?: { turns?: number; steps?: number; llmMs?: number; toolMs?: number; ttftMs?: number; decodeMs?: number; decodeTokens?: number };
            tokenUsage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
          };
        };
      };
      const vals = h?.projections?.values;
      const p = vals?.permissions;
      if (p && this.permSelect) {
        this.permSelect.setOptions(
          (p.options || []).map((o) => ({
            label: localizePermission(o.value ?? o.name, o.name),
            value: o.value ?? o.name,
          })),
          p.currentValue ?? null
        );
        void this.applyPreferredPermission(p.currentValue);
      }
      this.updateContextRing(vals?.contextPressure);
      if (vals) {
        this.updateSessionStats({
          sessionStats: vals.sessionStats,
          tokenUsage: vals.tokenUsage,
        });
      }
    } catch {
      /* ignore */
    }
  }

  /** Populate reasoning-effort choices from the model catalog. */
  private fillReasoningSelect(cat: ModelsCatalog): void {
    if (!this.reasoningSelect) return;
    let efforts: Array<{ id: string; name?: string }> | undefined;
    for (const g of cat.groups || []) {
      for (const m of g.models || []) {
        if (m.reasoning?.efforts) {
          efforts = m.reasoning.efforts;
          break;
        }
      }
      if (efforts) break;
    }
    if (!efforts || efforts.length === 0) {
      this.reasoningSelect.setHidden(true);
      return;
    }
    this.reasoningSelect.setHidden(false);
    const opts = efforts.map((e) => ({ label: e.name ?? e.id, value: e.id }));
    const cur = this.currentReasoningEffort;
    const cur0 = cur && efforts.some((e) => e.id === cur) ? cur : efforts[0]?.id ?? null;
    this.reasoningSelect.setOptions(opts, cur0);
  }

  private get currentReasoningEffort(): string | null {
    const m = this.lastModelCatalog;
    return m?.current?.reasoningEffort ?? null;
  }

  private lastModelCatalog: ModelsCatalog | null = null;

  private async onReasoningChangeValue(effort: string): Promise<void> {
    if (!this.dshSessionId) return;
    const cat = this.lastModelCatalog;
    const cur = cat?.current;
    if (!cur) return;
    try {
      await this.plugin.http.selectModel(this.dshSessionId, cur.provider!, cur.model!, effort);
      new Notice(`推理等级 → ${effort}`);
      // Refresh model catalog so current.reasoningEffort reflects the choice.
      try {
        const fresh = (await this.plugin.http.models(this.dshSessionId!)) as unknown as ModelsCatalog;
        this.applyModels(fresh);
      } catch {
        /* ignore */
      }
      this.savePreferred();
    } catch (e) {
      new Notice(`设置推理等级失败: ${(e as Error).message.slice(0, 60)}`);
    }
  }

  private async onPermChangeValue(val: string): Promise<void> {
    if (!this.dshSessionId) return;
    // Set the current session's permission preset via the /permission command.
    try {
      await this.plugin.http.commandsExecute(this.dshSessionId, `/permission ${val}`);
      new Notice(`权限 → ${val}`);
      const s = this.active();
      if (s) {
        s.preferredPermission = val;
        void this.persist();
      }
    } catch (e) {
      new Notice(`设置权限失败: ${(e as Error).message.slice(0, 60)}`);
    }
  }

  /** Open a menu of slash commands; picking one sends it as a message. */
  private async openCommandMenu(ev: MouseEvent): Promise<void> {
    const sid = this.dshSessionId ?? (await this.ensureHttpSession());
    if (!sid) {
      new Notice(t("dshNotConnected"));
      return;
    }
    let commands: Array<{ name: string; description?: string }> = [];
    try {
      commands = ((await this.plugin.http.commandsList(sid)) as unknown) as Array<{
        name: string;
        description?: string;
      }>;
    } catch {
      commands = [];
    }
    const menu = new Menu();
    if (!Array.isArray(commands) || commands.length === 0) {
      menu.addItem((i) => i.setTitle(t("noCommands")).setDisabled(true));
    } else {
      for (const c of commands) {
        const loc = localizeCommand(c.name, c.description);
        menu.addItem((i) => {
          i.setTitle(loc.desc ? `${loc.title} — ${loc.desc}` : loc.title);
          i.onClick(() => {
            // Insert the command into the input rather than executing directly,
            // so the user can confirm / add args.
            if (this.inputEl) {
              this.inputEl.value = "/" + c.name + " ";
              this.inputEl.focus();
            }
          });
        });
      }
    }
    // Show the command menu ABOVE the "+" button (right edge aligned with the
    // button's right edge, so it opens upward on the left without covering it).
    const target = ev.target as Element;
    const r = target?.getBoundingClientRect();
    if (r && r.width > 0) {
      menu.showAtPosition({ x: r.right, y: r.top, overlap: false });
      // Re-position it right-aligned to the button and anchored just above it.
      requestAnimationFrame(() => {
        const dom = (menu as unknown as { dom?: HTMLElement }).dom;
        if (dom && dom.isConnected) {
          const el = dom;
          el.style.position = "fixed";
          el.style.right = `${Math.max(0, window.innerWidth - r.right)}px`;
          el.style.top = `${Math.max(0, r.top - el.offsetHeight - 6)}px`;
          el.style.bottom = "auto";
          el.style.left = "auto";
        }
      });
    } else {
      menu.showAtMouseEvent(ev);
    }
  }

  /** Open the settings gear menu (configure API key / open dsh web). */
  private openSettingsMenu(ev: MouseEvent): void {
    const menu = new Menu();
    menu.setNoIcon();
    menu.addItem((item) => {
      item.setTitle(t("configureKey"));
      item.onClick(() => void this.openApiKeyModal());
    });
    menu.addItem((item) => {
      item.setTitle(t("openWeb"));
      item.onClick(() => void this.openWeb());
    });
    // Open below the gear button, right-aligned to it, so the menu stays in
    // view and doesn't cover the button.
    const target = ev.target as Element;
    const r = target?.getBoundingClientRect();
    if (r && r.width > 0) {
      menu.showAtPosition({ x: r.right, y: r.bottom, overlap: false });
      requestAnimationFrame(() => {
        const dom = (menu as unknown as { dom?: HTMLElement }).dom;
        if (dom && dom.isConnected) {
          const el = dom;
          const vw = window.innerWidth;
          // Right edge flush with the button; clamp to keep it inside the viewport.
          const rightOff = Math.min(vw - r.right, vw - 8);
          el.style.position = "fixed";
          el.style.right = `${Math.max(4, rightOff)}px`;
          el.style.top = `${r.bottom + 6}px`;
          el.style.bottom = "auto";
          el.style.left = "auto";
        }
      });
    } else {
      menu.showAtMouseEvent(ev);
    }
  }

  /** Open a modal to enter/save the DeepSeek API key. */
  private async openApiKeyModal(): Promise<void> {
    const dlg = new ApiKeyModal(this.app, this);
    dlg.open();
    return undefined;
  }

  /** Open the dsh web UI in the browser. */
  private async openWeb(): Promise<void> {
    let url = this.plugin.http?.url || "";
    if (!url) {
      // Fall back to the default local dsh web host.
      url = "http://127.0.0.1:3080";
    }
    try {
      window.open(url, "_blank");
    } catch {
      new Notice(`无法打开: ${url}`);
    }
  }

  private updateContextRing(cp?: {
    pressureTokens?: number;
    projectedTokens?: number;
    contextWindow?: number;
  }): void {
    this.lastContext = null;
    if (!this.contextRingEl) return;
    const fg = this.contextRingEl.querySelector("circle[stroke='var(--obdsh-brand, #4d6bfe)']") as SVGCircleElement | null;
    if (!fg) return;
    const used = cp?.projectedTokens ?? cp?.pressureTokens;
    const win = cp?.contextWindow;
    if (!used || !win) {
      fg.style.strokeDashoffset = String(Number(fg.dataset.circ));
      return;
    }
    const pct = Math.min(100, Math.round((used / win) * 100));
    const circ = Number(fg.dataset.circ) || 1;
    fg.style.strokeDashoffset = String(circ * (1 - pct / 100));
    this.lastContext = { used, window: win, pct };
  }

  /** Show a web-style context-usage card when the user clicks the context ring. */
  private async showContextInfo(e: MouseEvent): Promise<void> {
    e.stopPropagation();
    try {
      const cb = this.lastContext ?? null;
      void cb;
      const sid = this.dshSessionId;
      let breakdown: { sys?: number; tools?: number; msg?: number } | null = null;
      let used = this.lastContext?.used ?? 0;
      let win = this.lastContext?.window ?? 0;
      let pct = this.lastContext?.pct ?? 0;
      if (sid) {
        const h = (await this.plugin.http.history(sid, 1)) as unknown as {
          projections?: {
            values?: {
              contextPressure?: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number };
              contextBreakdown?: { systemTokens?: number; toolsTokens?: number; messageTokens?: number };
            };
          };
        };
        const vals = h?.projections?.values;
        const cp = vals?.contextPressure;
        const bd = vals?.contextBreakdown;
        used = cp?.projectedTokens ?? cp?.pressureTokens ?? used;
        win = cp?.contextWindow ?? win;
        if (used && win) pct = Math.min(100, Math.round((used / win) * 100));
        if (bd) breakdown = { sys: bd.systemTokens, tools: bd.toolsTokens, msg: bd.messageTokens };
      }
      this.renderContextInfoCard(used, win, pct, breakdown, e);
    } catch {
      this.renderContextInfoCard(
        this.lastContext?.used ?? 0,
        this.lastContext?.window ?? 0,
        this.lastContext?.pct ?? 0,
        null,
        e
      );
    }
  }

  /** Render the web-style info card (floating) near the clicked ring. */
  private renderContextInfoCard(
    used: number,
    win: number,
    pct: number,
    breakdown: { sys?: number; tools?: number; msg?: number } | null,
    ev: MouseEvent
  ): void {
    // Remove any previous card.
    document.querySelector(".obdsh-ctx-card")?.remove();
    const card = document.createElement("div");
    card.className = "obdsh-ctx-card";
    // Header row: used-percent (left) + token totals (right, same line).
    const header = document.createElement("div");
    header.className = "obdsh-ctx-headrow";
    const head = document.createElement("div");
    head.className = "obdsh-ctx-head";
    head.textContent = `已用 ${pct || 0}%`;
    const sub = document.createElement("div");
    sub.className = "obdsh-ctx-sub";
    sub.textContent = `~${fmtTok(used)} / ${fmtTok(win)}`;
    header.appendChild(head);
    header.appendChild(sub);
    card.appendChild(header);
    // Progress bar under the header row (fraction of the context window used).
    const bar = document.createElement("div");
    bar.className = "obdsh-ctx-bar";
    const fill = document.createElement("div");
    fill.className = "obdsh-ctx-bar-fill";
    fill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
    const rows: Array<[string, number]> = [
      ["系统提示词", breakdown?.sys ?? 0],
      ["工具", breakdown?.tools ?? 0],
      ["对话消息", breakdown?.msg ?? 0],
    ];
    if (breakdown) {
      const list = document.createElement("div");
      list.className = "obdsh-ctx-list";
      for (const [label, n] of rows) {
        const row = document.createElement("div");
        row.className = "obdsh-ctx-row";
        row.innerHTML = `<span>${label}</span><span>~${fmtTok(n)}</span>`;
        list.appendChild(row);
      }
      card.appendChild(list);
    }
    document.body.appendChild(card);
    const rect = (ev.target as Element).getBoundingClientRect();
    card.style.position = "fixed";
    card.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
    card.style.zIndex = "9998";
    // Prefer opening ABOVE the ring (like the dropdown); fall back below if
    // there isn't enough room.
    card.style.visibility = "hidden";
    const cardH = card.offsetHeight || card.scrollHeight || 0;
    const gap = 8;
    let top = rect.top - cardH - gap;
    if (top < 8) top = Math.min(rect.bottom + gap, window.innerHeight - cardH - 8);
    if (top < 8) top = 8;
    card.style.top = `${top}px`;
    card.style.visibility = "visible";
    // Close on outside click / Esc.
    const closeCard = (e2: Event) => {
      if (card.contains(e2.target as Node)) return;
      card.remove();
      document.removeEventListener("mousedown", closeCard);
      document.removeEventListener("keydown", onEsc, true);
    };
    const onEsc = (e2: KeyboardEvent) => {
      if (e2.key === "Escape") {
        card.remove();
        document.removeEventListener("mousedown", closeCard);
        document.removeEventListener("keydown", onEsc, true);
      }
    };
    document.addEventListener("mousedown", closeCard);
    document.addEventListener("keydown", onEsc, true);
  }

  // ------------------------------------------------------------------
  // HTTP session setup
  // ------------------------------------------------------------------
  private sessionCwd(): string | undefined {
    // 1) explicit override, if the user set one in settings
    const override = this.plugin.settings.workingDir?.trim();
    if (override) return override;
    // 2) otherwise follow the CURRENTLY OPEN VAULT's folder so swapping vaults
    //    (or machines) automatically re-targets the right notes directory.
    try {
      const adapter = this.plugin.app.vault.adapter as unknown as { getBasePath?: () => string };
      return (typeof adapter.getBasePath === "function" ? adapter.getBasePath() : undefined) || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Ensure the active local session has a dedicated, clean dsh session.
   * Returns the dsh session id, or null if HTTP is unavailable (→ headless).
   */
  private async ensureHttpSession(): Promise<string | null> {
    const s = this.active();
    if (!s) return null;

    try {
      await this.plugin.http.connect();
      // dsh sessions are ephemeral on the host process: after a host/plugin
      // restart a persisted sessionId no longer exists. Reuse it only if it is
      // still valid on the current host; otherwise create a fresh one so the
      // panel connects without waiting for the first message.
      if (s.dshId) {
        try {
          const m = (await this.plugin.http.models(s.dshId)) as { current?: unknown };
          if (m && typeof m.current === "object") {
            this.dshSessionId = s.dshId;
            return s.dshId;
          }
        } catch {
          /* stale id — fall through and create a fresh session */
        }
      }
      // Create a NEW dsh session each time so its history is clean (no stale
      // assistant messages from other chats to confuse polling/streams).
      // Pin the session's working dir to the vault so "workspace-write" affects
      // the user's notes (not the Obsidian install directory).
      const cwd = this.sessionCwd();
      const created = (await this.plugin.http.createSession(
        cwd ? { cwd } : {}
      )) as unknown as { sessionId: string };
      s.dshId = created.sessionId;
      this.dshSessionId = created.sessionId;
      void this.persist();
      void this.populateComposerControls();
      return s.dshId;
    } catch (e) {
      this.dshSessionId = null;
      void new Notice(`dsh HTTP unavailable → headless: ${(e as Error).message.slice(0, 60)}`);
      return null;
    }
  }

  private modelNameShort(): string {
    if (!this.currentModel) return "…";
    // e.g. "deepseek-v4-flash"
    const idx = this.currentModel.indexOf(":");
    return idx >= 0 ? this.currentModel.slice(idx + 1) : this.currentModel;
  }

  /** Apply a models catalog to the composer controls (model button, reasoning). */
  private applyModels(cat: ModelsCatalog): void {
    this.lastModelCatalog = cat;
    this.setModelFrom(cat);
    this.fillModelSelect(cat);
    this.fillReasoningSelect(cat);
  }

  /** Populate the model custom dropdown, grouped by provider. */
  private fillModelSelect(cat: ModelsCatalog): void {
    if (!this.modelSelect) return;
    const cur = cat.current;
    const opts: Array<{ label: string; value: string; group?: string }> = [];
    for (const g of cat.groups || []) {
      for (const m of g.models || []) {
        opts.push({
          label: m.name || m.id,
          value: `${g.id}::${m.id}`,
          group: g.name || g.id,
        });
      }
    }
    const want = cur ? `${cur.provider}::${cur.model}` : null;
    this.modelSelect.setOptions(opts, want);
  }

  /** Handle model dropdown change: switch provider+model. */
  private async onModelSelect(): Promise<void> {
    const sel = this.modelSelect?.valueNow;
    if (!sel || !this.dshSessionId) return;
    const [provider, model] = sel.split("::");
    if (!provider || !model) return;
    await this.doSelectModel(provider, model);
  }

  private async doSelectModel(provider: string, model: string): Promise<void> {
    if (!this.dshSessionId) return;
    try {
      const sel = (await this.plugin.http.selectModel(this.dshSessionId, provider, model)) as {
        selected?: { provider?: string; model?: string };
      };
      const cur = (sel.selected || {}) as { provider?: string; model?: string };
      this.setModelFrom({ current: cur });
      if (this.modelSelect) {
        this.modelSelect.setValue(`${cur.provider}::${cur.model}`);
      }
      new Notice(`Model → ${this.modelNameShort()}`);
      // Refresh reasoning-effort dropdown after model switch.
      try {
        const cat = (await this.plugin.http.models(this.dshSessionId!)) as unknown as ModelsCatalog;
        this.applyModels(cat);
      } catch { /* ignore */ }
      // Persist the user's model choice so it survives plugin reloads.
      this.savePreferred();
    } catch (e) {
      new Notice(`Model change failed: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  /** Persist the active session's selected model + reasoning-effort preference. */
  private savePreferred(): void {
    const s = this.active();
    if (!s) return;
    const cur = this.lastModelCatalog?.current;
    if (cur?.provider && cur?.model) {
      s.preferredModel = {
        provider: cur.provider,
        model: cur.model,
        reasoningEffort: this.currentReasoningEffort ?? undefined,
      };
    }
    void this.persist();
  }

  /** Re-apply the stored model preference onto the dsh session if it differs. */
  private async applyPreferredModel(cat: ModelsCatalog): Promise<void> {
    const s = this.active();
    if (!s?.preferredModel || !this.dshSessionId) return;
    const p = s.preferredModel;
    const current = cat?.current;
    // Re-apply if model OR reasoning-effort differs from the stored preference.
    const sameModel = current?.provider === p.provider && current?.model === p.model;
    const sameEffort = !p.reasoningEffort || current?.reasoningEffort === p.reasoningEffort;
    if (sameModel && sameEffort) return;
    // Ensure the preferred model actually exists in the catalog before applying.
    const found = (cat.groups || []).some((g) =>
      (g.models || []).some((m) => g.id === p.provider && m.id === p.model)
    );
    if (!found) return;
    try {
      await this.plugin.http.selectModel(this.dshSessionId, p.provider, p.model, p.reasoningEffort);
      const fresh = (await this.plugin.http.models(this.dshSessionId!)) as unknown as ModelsCatalog;
      this.applyModels(fresh);
    } catch {
      /* ignore */
    }
  }

  /** Re-apply the stored permission preference if it differs from current. */
  private async applyPreferredPermission(currentValue?: string): Promise<void> {
    const s = this.active();
    if (!s?.preferredPermission || !this.dshSessionId) return;
    if (s.preferredPermission === currentValue) return;
    try {
      await this.plugin.http.commandsExecute(this.dshSessionId, `/permission ${s.preferredPermission}`);
    } catch {
      /* ignore */
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
    // Don't persist empty (never-messaged) sessions so clicking "New session"
    // without sending anything doesn't leave stale blank rows behind.
    const live = this.sessions.filter((s) => s.messages.length > 0);
    return this.plugin.saveSessions(live);
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
    this.dshSessionId = null;
    this.permSelect?.setOptions([], null);
    this.reasoningSelect?.setOptions([], null);
    this.setStatusNoData();
  }

  private selectSession(id: string): void {
    this.plugin.bridge.abortAll();
    this.activeId = id;
    this.ensureSession();
    this.renderMessages();
    // Point composer controls + status bar at the newly selected session.
    const s = this.active();
    this.dshSessionId = s?.dshId || null;
    this.permSelect?.setOptions([], null);
    this.reasoningSelect?.setOptions([], null);
    // Status bar always follows the active session: show the session's stats
    // when a dsh session is bound, otherwise show "no data".
    if (s?.dshId) {
      void this.populateComposerControls();
    } else {
      this.setStatusNoData();
    }
    this.closeHistory();
  }

  private toggleHistory(): void {
    const willOpen = this.historyPanelEl.hidden;
    this.historyPanelEl.hidden = !willOpen;
    if (willOpen) {
      this.rebuildHistoryList();
      this.installHistoryAutoClose();
    } else {
      this.uninstallHistoryAutoClose();
    }
  }

  private historyAutoClose: ((e: MouseEvent) => void) | null = null;

  private installHistoryAutoClose(): void {
    this.uninstallHistoryAutoClose();
    this.historyAutoClose = (e) => {
      // Close the history panel when clicking outside it (and outside its
      // toggle button / any open dropdown).
      const t = e.target as Node | null;
      if (!t) return;
      if (this.historyPanelEl.contains(t)) return;
      if ((t as Element).closest?.(".obdsh-history-toggle")) return;
      this.closeHistory();
    };
    // Use a capturing mousedown so it wins over other handlers; small timeout
    // avoids closing on the same click that opened it.
    setTimeout(() => {
      if (this.historyAutoClose) {
        document.addEventListener("mousedown", this.historyAutoClose, true);
      }
    }, 10);
  }

  private uninstallHistoryAutoClose(): void {
    if (this.historyAutoClose) {
      document.removeEventListener("mousedown", this.historyAutoClose, true);
      this.historyAutoClose = null;
    }
  }

  private closeHistory(): void {
    if (this.historyPanelEl) this.historyPanelEl.hidden = true;
    this.uninstallHistoryAutoClose();
  }

  private rebuildHistoryList(): void {
    this.historyPanelEl.empty();
    // Empty sessions (created but never sent a message) are not real
    // conversations yet — don't list them.
    const visible = this.sessions.filter((s) => s.messages.length > 0);
    if (visible.length === 0) {
      this.historyPanelEl.createEl("div", {
        cls: "obdsh-history-empty",
        text: t("noConversations"),
      });
      return;
    }
    for (const s of visible) {
      const item = this.historyPanelEl.createDiv({
        cls: "obdsh-history-item" + (s.id === this.activeId ? " is-active" : ""),
      });
      item.createEl("span", { cls: "obdsh-history-item-title", text: s.title });
      item.createEl("span", {
        cls: "obdsh-history-item-count",
        text: `${s.messages.length} msg`,
      });
      item.addEventListener("click", () => this.selectSession(s.id));
      item.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        void this.showSessionContextMenu(s, ev);
      });
    }
  }

  /** Context menu (right-click) on a history session: rename/archive/fork. */
  private async showSessionContextMenu(s: ChatSession, ev: MouseEvent): Promise<void> {
    // Sessions listed in history all have content (empty ones are filtered),
    // so every menu action is available. dsh-bounded actions degrade to
    // local-only behavior when the session has no dshId yet.
    const menu = new Menu();
    menu.addItem((i) => {
      i.setTitle(t("rename"));
      i.setIcon("pencil");
      i.onClick(() => void this.renameSessionPrompt(s));
    });
    menu.addItem((i) => {
      i.setTitle(t("fork"));
      i.setIcon("copy");
      i.onClick(() => void this.forkSessionOf(s));
    });
    menu.addItem((i) => {
      i.setTitle(t("archive"));
      i.setIcon("archive");
      i.onClick(() => void this.archiveSessionOf(s));
    });
    menu.showAtMouseEvent(ev);
  }

  private async renameSessionPrompt(s: ChatSession): Promise<void> {
    const modal = new PromptModal(this.app, t("renameTitle"), t("renamePrompt"), s.title, async (val) => {
      const clean = val?.trim();
      if (!clean) return;
      // Rename locally first (always works), then sync to dsh when bound.
      s.title = clean;
      this.rebuildHistoryList();
      void this.persist();
      new Notice(t("renamed"));
      if (s.dshId) {
        try {
          await this.plugin.http.renameSession(s.dshId, clean);
        } catch {
          /* local rename already applied; dsh sync is best-effort */
        }
      }
    });
    modal.open();
  }

  private async forkSessionOf(s: ChatSession): Promise<void> {
    if (s.dshId) {
      try {
        const f = (await this.plugin.http.forkSession(s.dshId)) as unknown as { sessionId?: string };
        const newId = f?.sessionId;
        const copy: ChatSession = {
          id: this.newId(),
          title: `${s.title} (fork)`,
          source: "obsidian",
          ...(newId ? { dshId: newId } : {}),
          messages: [...s.messages],
          createdAt: Date.now(),
        };
        this.sessions.unshift(copy);
        this.rebuildHistoryList();
        void this.persist();
        new Notice(t("forked"));
        return;
      } catch (e) {
        new Notice(`Fork failed: ${(e as Error).message.slice(0, 60)}`);
        return;
      }
    }
    // No bound dsh session → duplicate the conversation locally.
    const copy: ChatSession = {
      id: this.newId(),
      title: `${s.title} (fork)`,
      source: "obsidian",
      messages: [...s.messages],
      createdAt: Date.now(),
    };
    this.sessions.unshift(copy);
    this.rebuildHistoryList();
    void this.persist();
    new Notice(t("forked"));
  }

  private async archiveSessionOf(s: ChatSession): Promise<void> {
    const dshId = s.dshId;
    // Remove from the local list first (always works), then archive on dsh.
    this.sessions = this.sessions.filter((x) => x.id !== s.id);
    if (this.activeId === s.id) {
      this.activeId = this.sessions[0]?.id || this.newId();
      this.ensureSession();
      this.renderMessages();
    }
    this.rebuildHistoryList();
    void this.persist();
    new Notice(t("archived"));
    if (dshId) {
      try {
        await this.plugin.http.archiveSession(dshId);
      } catch {
        /* local removal already applied; dsh archive is best-effort */
      }
    }
  }

  private updateActiveSession(
    role: "user" | "assistant",
    text: string,
    reasoning?: string
  ): void {
    const s = this.active();
    const msg: ChatMessage = { role, text };
    if (reasoning) msg.reasoning = reasoning;
    s.messages.push(msg);
    if (s.messages.length === 1) {
      s.title = s.messages[0].text.replace(/\s+/g, " ").slice(0, 40) || t("newChat");
    }
  }

  // ------------------------------------------------------------------
  // Messaging
  // ------------------------------------------------------------------
  /** Single send/stop entry point: click or Enter toggles the action. */
  private async onActionClick(): Promise<void> {
    if (this.busy) this.onStop();
    else await this.send();
  }

  /** Flip the round corner button between its idle (send arrow) and busy (stop) faces. */
  private setActionButtonBusy(busy: boolean): void {
    if (busy) {
      this.sendBtn.classList.add("obdsh-stop");
      this.sendBtn.innerHTML = STOP_ICON;
      this.sendBtn.setAttr("aria-label", t("stop"));
      this.sendBtn.setAttr("title", t("stop"));
    } else {
      this.sendBtn.classList.remove("obdsh-stop");
      this.sendBtn.innerHTML = SEND_ICON;
      this.sendBtn.setAttr("aria-label", t("send"));
      this.sendBtn.setAttr("title", t("send"));
    }
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = "";
    this.updateActiveSession("user", text);
    this.appendMessage("user", text);
    this.busy = true;
    this.stopped = false;
    this.setActionButtonBusy(true);

    const { row, body } = this.appendTyping();

    try {
      // Resolve (or create) a clean dsh session for this local conversation.
      this.dshSessionId = await this.ensureHttpSession();
      if (this.dshSessionId) {
        await this.streamFromDsh(this.dshSessionId, text, row, body);
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
      this.setActionButtonBusy(false);
      this.inputEl.focus();
      this.rebuildHistoryList();
      void this.persist();
    }
  }

  private async streamFromDsh(sessionId: string, text: string, row: HTMLElement, body: HTMLElement): Promise<void> {
    await this.plugin.hostManager.ensureStarted();

    // Single, reliable path: submit the prompt once, then poll session.history
    // for the reply. (Obsidian's renderer blocks WebSocket vs local ws://, so we
    // avoid a WS dependency entirely — this is robust everywhere.)
    const before = await this.getLatestSeq(sessionId);
    try {
      const ack = await this.plugin.http.prompt(sessionId, text);
      if (ack && (ack as { accepted?: boolean }).accepted === false) {
        throw new Error("dsh did not accept the message (agent busy?) — try again");
      }
      const final = await this.pollAssistantText(sessionId, before, 180000, row, body);
      // pollAssistantText already rendered the reasoning box + reply text into
      // `body`; record only the clean final text as conversational history.
      if (final.text.trim()) {
        this.updateActiveSession("assistant", final.text, final.reasoning || undefined);
      } else if (!final.reasoning.trim()) {
        const msg = `**${t("errorPrefix")}:** no reply from dsh within timeout.`;
        this.updateActiveSession("assistant", msg);
      }
      // Refresh the fixed bottom stats bar with the whole session's aggregates.
      const st = await this.fetchSessionStats(sessionId);
      if (st) {
        this.updateSessionStats(st);
        this.updateContextRing(
          (st as { contextPressure?: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } }).contextPressure
        );
      }
    } catch (e) {
      // Show the prompt/session error explicitly — never swallow it.
      const msg = `**${t("errorPrefix")}:** ${(e as Error).message}`;
      console.error("[obsidian-dsh] streamFromDsh failed:", e);
      this.updateActiveSession("assistant", msg);
      await this.renderMarkdown(body, msg);
    }
  }

  /** Count assistant messages currently in history (used as a baseline). */
  /** Return the highest event seq currently in the session's history. */
  private async getLatestSeq(sessionId: string): Promise<number> {
    try {
      const h = (await this.plugin.http.history(sessionId, 100)) as {
        events?: Array<{ event?: { seq?: number } }>;
      };
      let max = 0;
      for (const e of h.events || []) {
        const s = e.event?.seq ?? 0;
        if (s > max) max = s;
      }
      return max;
    } catch {
      return 0;
    }
  }

  /** Poll history until a new, non-empty assistant reply beyond `baseline` appears. */
  private async pollAssistantText(
    sessionId: string,
    baseline: number,
    timeoutMs: number,
    row: HTMLElement,
    body: HTMLElement
  ): Promise<{ text: string; reasoning: string }> {
    const deadline = Date.now() + timeoutMs;
    const seen = new Set<number>();
    let latest: { text: string; reasoning: string } = { text: "", reasoning: "" };
    let latestSeq = baseline; // ignore everything before this turn's baseline
    let stableTicks = 0;

    while (Date.now() < deadline) {
      if (this.stopped) break;
      let events: Array<{ event?: { seq?: number; type?: string; data?: { message?: unknown } } }> = [];
      try {
        const hist = (await this.plugin.http.history(sessionId, 100)) as unknown as {
          events?: Array<{ event?: { seq?: number; type?: string; data?: { message?: unknown } } }>;
        };
        events = hist?.events || [];
      } catch {
        events = [];
      }

      // Track the newest assistant/message of THIS turn (seq > baseline).
      let anyNew = false;
      for (const e of events) {
        if (e.event?.type !== "assistant/message") continue;
        const seq = e.event.seq ?? 0;
        if (seq <= baseline) continue; // skip previous turns' replies entirely
        const content = (e.event.data?.message as { content?: unknown[] } | undefined)?.content;
        const parsed = this.splitMessage(content);
        if (seq > latestSeq) {
          latestSeq = seq;
          latest = parsed;
          anyNew = true;
        }
        if (!seen.has(seq) && (parsed.text.trim() || parsed.reasoning.trim())) {
          seen.add(seq);
          await this.renderReplyWithReasoning(row, body, parsed);
          this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }
      }

      // Only settle once we have at least one NEW assistant/reply for this turn
      // AND its seq has stopped growing (stable for a couple polls).
      if (latestSeq > baseline && latest.text.trim()) {
        if (anyNew) {
          stableTicks = 0;
        } else if (++stableTicks >= 3) {
          return latest;
        }
      } else {
        stableTicks = 0;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return latest.text.trim() ? latest : { text: "", reasoning: "" };
  }

  /** Split an assistant message content array into reasoning vs final text. */
  private splitMessage(content: unknown): { text: string; reasoning: string } {
    if (!Array.isArray(content)) return { text: "", reasoning: "" };
    let text = "";
    let reasoning = "";
    for (const item of content) {
      const it = item as { type?: string; text?: string };
      const t = it.text || "";
      if (it.type === "reasoning") reasoning += t;
      else if (t) text += t;
    }
    return { text, reasoning };
  }

  /** Render an independent, collapsed "thinking" block (if any) before the reply bubble. */
  private async renderReplyWithReasoning(
    row: HTMLElement,
    body: HTMLElement,
    r: { text: string; reasoning: string }
  ): Promise<void> {
    // Remove any previous per-turn thinking card so incremental polls replace it.
    const oldCard = row.querySelector(".obdsh-reasoning-card");
    if (oldCard) oldCard.remove();
    if (r.reasoning.trim()) {
      const card = row.createEl("details", { cls: "obdsh-reasoning-card" });
      card.createEl("summary", { text: "🤔 思考过程" });
      const pre = card.createDiv({ cls: "obdsh-reasoning-body" });
      pre.createEl("span", { text: r.reasoning });
      row.insertBefore(card, body);
    }
    body.empty();
    // The live reply reuses the typing bubble; drop the loading-indicator
    // class (inline-flex would stack block-level markdown horizontally).
    body.removeClass("obdsh-typing");
    if (r.text.trim()) {
      // Render as Markdown so live replies match the formatted replay.
      await this.renderMarkdown(body, r.text);
    }
  }

  /** Get aggregated per-session stats (turns/steps/times/tokens) from history. */
  private async fetchSessionStats(sessionId: string) {
    try {
      const h = (await this.plugin.http.history(sessionId, 5)) as {
        projections?: {
          values?: {
            sessionStats?: {
              turns?: number;
              steps?: number;
              llmMs?: number;
              toolMs?: number;
              ttftMs?: number;
              decodeMs?: number;
              decodeTokens?: number;
            };
            tokenUsage?: {
              uncachedInputTokens?: number;
              outputTokens?: number;
              cacheReadTokens?: number;
              cacheWriteTokens?: number;
            };
          };
        };
      };
      return h?.projections?.values ?? null;
    } catch {
      return null;
    }
  }

  /** Show the status bar in its empty "no data" state for the active session. */
  private setStatusNoData(): void {
    if (!this.statusEl) return;
    this.statusEl.empty();
    this.statusEl.createSpan({ cls: "obdsh-status-text", text: t("dshNoStats") });
    this.statusEl.hidden = false;
  }

  /** Render the web-style aggregate stats in the fixed bottom bar. */
  private updateSessionStats(st: {
    sessionStats?: { turns?: number; steps?: number; llmMs?: number; toolMs?: number; ttftMs?: number; decodeMs?: number; decodeTokens?: number };
    tokenUsage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  }): void {
    if (!this.statusEl) return;
    const ss = st.sessionStats || {};
    const tu = st.tokenUsage || {};
    const parts: string[] = [];

    if (ss.turns) parts.push(`${ss.turns}轮·${ss.steps ?? 0}步`);
    if (ss.llmMs) parts.push(`LLM ${fmtDur(ss.llmMs)}`);
    if (ss.toolMs) parts.push(`工具调用${fmtDur(ss.toolMs)}`);
    if (ss.ttftMs) parts.push(`首token${(ss.ttftMs / 1000).toFixed(1)}s`);
    const decodeSec = (ss.decodeMs ?? 0) / 1000;
    if (decodeSec > 0 && ss.decodeTokens) {
      parts.push(`${(ss.decodeTokens / decodeSec).toFixed(0)}tok/s`);
    }
    const input = tu.uncachedInputTokens ?? 0;
    const cr = tu.cacheReadTokens ?? 0;
    const cw = tu.cacheWriteTokens ?? 0;
    const totalIn = input + cr + cw;
    if (totalIn > 0) {
      const hit = Math.round((cr / totalIn) * 100);
      parts.push(`缓存命中${hit}%`);
    }
    if (input > 0 || (tu.outputTokens ?? 0) > 0) {
      parts.push(`输入${fmtTok(input)} tok·输出${fmtTok(tu.outputTokens ?? 0)} tok`);
    }

    const label = parts.join(" | ");
    this.statusEl.empty();
    const text = this.statusEl.createSpan({ cls: "obdsh-status-text" });
    text.setText(label || "—");
    // Show the full stats string on hover when it is truncated.
    text.setAttr("title", label || "");
    this.statusEl.hidden = false;
  }

  private onStop(): void {
    this.stopped = true;
    this.plugin.bridge.abortAll();
    // Web-style Stop: tell dsh to cancel the running turn on this session.
    if (this.dshSessionId) {
      void this.plugin.http.cancel(this.dshSessionId).catch(() => {});
    }
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
    this.attachCopyButton(row, text);
    return bubble;
  }

  private appendMessageReplay(role: "user" | "assistant", text: string, reasoning?: string): void {
    const row = this.messagesEl.createDiv({ cls: `obdsh-msg obdsh-msg-${role}` });
    const avatar = row.createDiv({
      cls: "obdsh-avatar" + (role === "assistant" ? " obdsh-avatar-ai" : " obdsh-avatar-user"),
    });
    avatar.setText(role === "assistant" ? "❍" : "你");
    const bubble = row.createDiv({ cls: "obdsh-bubble" });
    if (role === "user") {
      bubble.setText(text);
    } else if (reasoning && reasoning.trim()) {
      this.renderReplyWithReasoning(row, bubble, { text, reasoning });
    } else {
      void this.renderMarkdown(bubble, text);
    }
    this.attachCopyButton(row, text);
  }

  /** Small copy button that appears on hover and copies the raw message text. */
  private attachCopyButton(row: HTMLElement, text: string): void {
    const btn = row.createEl("button", {
      cls: "obdsh-copy-btn",
      attr: { title: t("copy"), "aria-label": t("copy") },
    });
    btn.setText("⧉");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.copyText(text, btn);
    });
  }

  private async copyText(text: string, btn: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.setText(t("copied"));
      setTimeout(() => btn.setText(old ?? "⧉"), 1200);
    } catch {
      // fallback for restricted clipboard
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        btn.setText(t("copied"));
        setTimeout(() => {
          btn.setText("⧉");
        }, 1200);
      } catch {
        new Notice(t("copyFailed"));
      }
    }
  }

  private appendTyping(): { row: HTMLElement; body: HTMLElement } {
    const row = this.messagesEl.createDiv({ cls: "obdsh-msg obdsh-msg-assistant" });
    const avatar = row.createDiv({ cls: "obdsh-avatar obdsh-avatar-ai" });
    avatar.setText("❍");
    const bubble = row.createDiv({ cls: "obdsh-bubble obdsh-typing" });
    for (let i = 0; i < 3; i++) bubble.createSpan({ cls: "obdsh-typing-dot" });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return { row, body: bubble };
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
  current?: { provider?: string; model?: string; reasoningEffort?: string };
  groups?: Array<{
    id: string;
    name?: string;
    models?: Array<{
      id: string;
      name?: string;
      reasoning?: { efforts?: Array<{ id: string; name?: string }>; defaultEffort?: string };
    }>;
  }>;
}

/** Format a duration in ms as compact h/m/s (e.g. 43m41s). */
function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return r ? `${h}h${m % 60}m` : `${h}h${m % 60}m`;
}

/** Format a token count with K/M units (e.g. 112M, 245K). */
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Localize a permission preset from the dsh session. Falls back to the raw
 * value trimmed of a leading `/`, or a generic "Permission" label.
 */
function localizePermission(value: string, name?: string): string {
  let key = (value || "").trim();
  if (key.startsWith("/")) key = key.slice(1);
  let mapped: string | null = null;
  if (key === "read-only") mapped = t("permissionPresetReadOnly");
  else if (key === "workspace-write") mapped = t("permissionPresetWorkspaceWrite");
  else if (key === "danger-full-access") mapped = t("permissionPresetDangerFullAccess");
  else if (key === "custom") mapped = t("permissionPresetCustom");
  if (mapped) return mapped;
  if (name && name.trim() && name.trim() !== "/") return name.trim();
  if (key) return key;
  return t("permissionUnknown");
}

/** Localize a dsh slash-command into the current UI language. */
function localizeCommand(name: string, description?: string): { title: string; desc?: string } {
  const line = name.startsWith("/") ? name.slice(1) : name;
  switch (line) {
    case "compact":
      return { title: `/${line} — ${t("cmdCompact")}`, desc: t("cmdCompactDesc") };
    case "export":
      return { title: `/${line} — ${t("cmdExport")}`, desc: t("cmdExportDesc") };
    case "feedback":
      return { title: `/${line} — ${t("cmdFeedback")}`, desc: t("cmdFeedbackDesc") };
    case "goal":
      return { title: `/${line} — ${t("cmdGoal")}`, desc: t("cmdGoalDesc") };
    case "permission":
      return { title: `/${line} — ${t("cmdPermission")}`, desc: t("cmdPermissionDesc") };
    case "plan":
      return { title: `/${line} — ${t("cmdPlan")}`, desc: t("cmdPlanDesc") };
    default:
      return { title: `/${line}` + (description ? ` — ${description}` : ""), desc: description };
  }
}

/** A minimal modal with a single text input and OK/Cancel. */
class PromptModal extends Modal {
  constructor(
    app: App,
    private titleText: string,
    private promptText: string,
    private initial: string,
    private onSubmit: (value: string | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { text: this.promptText, cls: "obdsh-prompt-desc" });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "obdsh-prompt-input",
      attr: { value: this.initial || "" },
    });
    input.focus();
    const actions = contentEl.createDiv({ cls: "obdsh-prompt-actions" });
    const cancel = actions.createEl("button", { cls: "obdsh-btn obdsh-btn-ghost", text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.onSubmit(null);
      this.close();
    });
    const ok = actions.createEl("button", { cls: "obdsh-btn obdsh-btn-primary", text: "OK" });
    ok.addEventListener("click", () => {
      this.onSubmit(input.value);
      this.close();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.onSubmit(input.value);
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Modal to enter/save the DeepSeek API key (writes to dsh's credentials file). */
class ApiKeyModal extends Modal {
  constructor(
    app: App,
    private view: ChatView
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("configureKey") });
    const configured = isKeyConfigured();
    contentEl.createEl("p", {
      cls: "obdsh-prompt-desc",
      text: configured
        ? "已配置 DeepSeek API key（写入 dsh 配置文件，插件/CLI/web 通用）。输入新值覆盖，或点「清除」。"
        : "请输入 DeepSeek API key。保存后会写入 dsh 配置文件，插件/CLI/web 通用。",
    });

    const input = contentEl.createEl("input", {
      type: "password",
      cls: "obdsh-prompt-input",
      attr: { placeholder: "sk-…" },
    });
    input.focus();

    const status = contentEl.createEl("div", {
      cls: "obdsh-prompt-desc",
      text: configured ? "当前：已配置" : "当前：未配置",
    });

    const actions = contentEl.createDiv({ cls: "obdsh-prompt-actions" });
    const cancel = actions.createEl("button", { cls: "obdsh-btn obdsh-btn-ghost", text: t("cmdCancel") });
    cancel.addEventListener("click", () => this.close());

    const clearBtn = actions.createEl("button", { cls: "obdsh-btn obdsh-btn-ghost", text: t("cmdClearKey") });
    clearBtn.addEventListener("click", () => {
      new ConfirmModal(this.app, t("cmdClearConfirm"), () => {
        const cleared = setStoredKey(null);
        new Notice(cleared ? t("cmdKeyCleared") : "清除失败");
        status.textContent = "当前：未配置";
        input.value = "";
      }).open();
    });

    const save = actions.createEl("button", { cls: "obdsh-btn obdsh-btn-primary", text: t("cmdSaveKey") });
    const saveKey = () => {
      const val = input.value.trim();
      if (!val) {
        new Notice(t("cmdKeyEmpty"));
        return;
      }
      const saved = setStoredKey(val);
      new Notice(saved ? t("cmdKeySaved") : "保存失败，请检查配置目录权限");
      if (saved) {
        status.textContent = "当前：已配置";
        this.close();
      }
    };
    save.addEventListener("click", saveKey);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveKey();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Obsidian-styled confirmation modal (replaces the native confirm()). */
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
