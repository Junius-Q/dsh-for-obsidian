import { DshHostManager } from "./dshHost";
import type { ObsidianDshSettings } from "../settings";

/**
 * A client for the dsh web HTTP API.
 *
 * Transport is "enveloped RPC": every call is `POST /api/<dotted-method>` with
 * a JSON `client-request` body and a `server-response` (business errors are
 * HTTP 200 with `{ok:false,error}` envelopes).
 *
 * Authentication: on this machine we dial loopback with no Origin, which the
 * browser-trust fence accepts directly (no token/trusted-host needed).
 */

export interface RpcValue {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
}

export interface DshClientOptions {
  getBaseUrl: () => string | null;
  timeoutMs?: number;
}

/** Minimal POST-json fetcher abstraction; Obsidian uses requestUrl, tests use fetch. */
export interface JsonPoster {
  (url: string, body: string): Promise<{ status: number; text: string }>;
}

/** Default fetcher using global fetch (Node/tests; works when fetch implies no CSP). */
export const fetchJsonPoster: JsonPoster = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return { status: res.status, text: await res.text() };
};

export class DshHttpClient {
  private host: DshHostManager;
  private getSettings: () => ObsidianDshSettings;
  private baseUrl: string | null = null;
  private timeoutMs: number;
  private postJson: JsonPoster;

  constructor(
    host: DshHostManager,
    getSettings: () => ObsidianDshSettings,
    timeoutMs = 120000,
    postJson: JsonPoster = fetchJsonPoster
  ) {
    this.host = host;
    this.getSettings = getSettings;
    this.timeoutMs = timeoutMs;
    this.postJson = postJson;
  }

  /** Start the host if needed and capture its base URL. */
  async connect(): Promise<void> {
    if (!this.baseUrl) {
      this.baseUrl = await this.host.ensureStarted(this.timeoutMs);
    }
  }

  get url(): string | null {
    return this.baseUrl;
  }

  /**
   * Perform a unary RPC call: `POST /api/<method>`.
   * Resolves the decoded `server-response` envelope (throws only on transport/
   * HTTP-level failure; business errors come back as `value.ok === false`).
   */
  async call(method: string, payload: unknown = {}): Promise<RpcValue> {
    await this.connect();
    const base = this.baseUrl!;
    const rpcId = "r-" + Math.random().toString(36).slice(2, 12);

    const body = JSON.stringify({
      type: "client-request",
      rpcId,
      method,
      payload,
    });

    const res = await this.postJson(`${base}/api/${method}`, body);
    if (res.status >= 400) {
      throw new Error(`dsh api ${method} http ${res.status}`);
    }
    let obj: { type?: string; rpcId?: string; result?: RpcValue };
    try {
      obj = JSON.parse(res.text);
    } catch {
      obj = {};
    }
    // Unwrap the server-response envelope; result carries {ok, value?, error?}.
    return (
      obj?.result ?? { ok: false, error: { message: "malformed response" } }
    ) as RpcValue;
  }

  /** Await a call that expects `ok:true` and return the value, else throw. */
  async callValue<T>(method: string, payload?: unknown): Promise<T> {
    const r = await this.call(method, payload);
    if (r.ok) return r.value as T;
    throw new Error(r.error?.message || r.error?.code || `dsh ${method} failed`);
  }

  // ------------------------------------------------------------------
  // Typed convenience methods (from the API contract)
  // ------------------------------------------------------------------
  async describe() {
    return this.callValue("host.describe");
  }

  async listSessions() {
    return this.callValue("session.list");
  }

  async createSession(payload: {
    workspaceId?: string;
    cwd?: string;
    sessionId?: string;
    agentPreset?: string;
  }) {
    return this.callValue("session.create", payload);
  }

  async prompt(sessionId: string, text: string) {
    // clientTimeZone must be a valid IANA name (or omitted) — never empty.
    const tz = safeTimeZone();
    return this.callValue("session.prompt", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text }],
      ...(tz ? { clientTimeZone: tz } : {}),
    });
  }

  async models(sessionId: string) {
    return this.callValue("session.models", { sessionId });
  }

  async selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string) {
    return this.callValue("session.selectModel", {
      sessionId,
      provider,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
  }

  async history(sessionId: string, maxMessages = 50, beforeSeq?: number) {
    return this.callValue("session.history", {
      sessionId,
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
      maxMessages,
    });
  }

  /** Execute a slash command (e.g. `/permission workspace-write`) on a session. */
  async commandsExecute(sessionId: string, line: string) {
    return this.callValue("commands/execute", {
      args: { agentId: sessionId, line },
    });
  }

  /** List available slash commands for a session. */
  async commandsList(sessionId: string) {
    return this.callValue("commands/list", {
      args: { agentId: sessionId },
    });
  }

  /** Cancel/stop the running turn on a session (web "Stop" behavior). */
  async cancel(sessionId: string) {
    return this.callValue("session.cancel", { sessionId });
  }

  /** Rename a session. */
  async renameSession(sessionId: string, title: string) {
    return this.callValue("session.rename", { sessionId, title });
  }

  /** Fork (branch) a new session from an existing one. */
  async forkSession(sessionId: string) {
    return this.callValue("session.fork", { sessionId });
  }

  /** Archive a session. */
  async archiveSession(sessionId: string) {
    return this.callValue("workspace.archiveSession", { sessionId });
  }
}

/** Return a valid IANA timezone name, or null if unavailable. */
function safeTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && !/^[A-Z\s]+$/.test(tz) ? tz : null;
  } catch {
    return null;
  }
}
