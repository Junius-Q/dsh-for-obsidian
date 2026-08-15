import { spawn, ChildProcess } from "child_process";

/**
 * Local relay for dsh's `approval/requested` and `question/requested` frames.
 *
 * Obsidian's `requestUrl()` cannot stream a response body (it resolves only
 * when the whole body is read), and the renderer's `fetch`/`EventSource` are
 * blocked by CSP ("Failed to fetch"). Both the approval and question flows are
 * delivered by dsh ONLY through the `GET /api/events.mux` Server-Sent-Events
 * stream — they never appear in `session.history`, so they cannot be polled.
 *
 * To bridge that gap we spawn a tiny local `node -e` process that opens the
 * SSE stream (node's native streaming fetch works fine inside child_process)
 * and forwards each `server-request` frame line to its stdout. The plugin main
 * thread then receives those frames over a normal child_process stdout stream.
 *
 * The relay is intentionally fire-and-forget per frame: it only surfaces mux
 * frames it understands (`approval/*`, `question/*`, `session/event`,
 * `stream/error`); everything else is ignored safely.
 */

/** One relayed frame (subset of dsh's MuxFrame that this plugin cares about). */
export type RelayFrame =
  | {
      type: "approval/requested";
      rpcId: string;
      sessionId: string;
      approvalId: string;
      toolName: string;
      callId?: string;
      reason?: string;
    }
  | {
      type: "approval/resolved";
      sessionId: string;
      approvalId: string;
      outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable";
    }
  | {
      type: "question/requested";
      rpcId: string;
      sessionId: string;
      questions: Array<{
        id: string;
        question: string;
        detail?: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;
    }
  | {
      type: "question/resolved";
      sessionId: string;
      questionRpcId: string;
      outcome: "answered" | "cancelled";
    }
  | {
      type: "session/event";
      sessionId: string;
      event: SessionEventSubscribe;
    }
  | { type: "stream/error"; error: { code?: string; message?: string } };

/** A raw `session/event` from the mux stream (full execution detail). */
export interface SessionEventSubscribe {
  seq?: number;
  type?: string;
  data?: Record<string, unknown>;
}

/**
 * node -e script: open the dsh mux stream over **WebSocket** and echo ONLY the
 * frames the plugin consumes (approval/question requests, tool calls, reasoning
 * chunks) to stdout as a line. Everything else — the overwhelming majority
 * (assistant/chunk text deltas, session/subscribed, inbox spliced, …) — is
 * dropped INSIDE the child so it never crosses stdout/the main thread.
 *
 * The local dsh web service answers `GET /api/events.mux` with `426 Upgrade
 * Required` (`Upgrade: websocket`) — the mux stream is WebSocket transport, not
 * plain SSE. Obsidian's renderer blocks WebSocket to localhost, but this relay
 * runs as a plain `node` child process (Node 20+ ships a global WebSocket).
 *
 * We print each kept message as a single `@`-prefixed JSON line (JSON never
 * contains a raw newline). On close/error we back off briefly and reopen — dsh
 * replays still-pending approval/question frames with the same rpcId, so
 * reconnect is idempotent.
 */
function relayScript(baseUrl: string): string {
  const url = `${baseUrl.replace(/\/$/, "")}/api/events.mux`;
  return [
    "const u=" + JSON.stringify(url) + ";",
    "const sleep=ms=>new Promise(r=>setTimeout(r,ms));",
    "function keep(m){" +
      "var p=m.payload||{},method=m.method||p.type;",
      "if(method==='session/event'){",
      "var et=p.event&&p.event.type;",
      "if(et==='tool/call')return true;",
      "if(et==='assistant/chunk'){var c=p.event&&p.event.data&&p.event.data.chunk;",
      "return !!(c&&c.block&&c.block.type==='reasoning');}",
      "return false;}",
      "return method==='approval/requested'||method==='approval/resolved'||",
      "method==='question/requested'||method==='question/resolved'||",
      "method==='stream/error';}",
    "async function open(){",
    "try{",
    "const ws=new WebSocket(u);",
    "ws.onmessage=(ev)=>{try{var m=JSON.parse(String(ev.data));",
      "if(m&&m.type==='server-request'&&keep(m)){process.stdout.write('@'+JSON.stringify(m).replace(/\\n/g,'')+'\\n');}",
      "}catch(e){};};",
    // Wait until the socket closes (or fails to open within 2s), then reopen.
    "await new Promise(resolve=>{",
    "let startTo=setTimeout(()=>{try{ws.close(1011)}catch(e){}},2000);",
    "const done=()=>{if(startTo)clearTimeout(startTo);ws.onclose=ws.onerror=ws.onopen=null;resolve();};",
    "ws.onopen=()=>{if(startTo)clearTimeout(startTo);};",
    "ws.onclose=done;",
    "ws.onerror=()=>done();",
    "});",
    "}catch(e){}",
    "await sleep(1200);",
    "}",
    "(async()=>{for(;;){await open();}})();",
  ].join("");
}

export type MuxRelayListener = (frame: RelayFrame) => void;

/**
 * Owns the relay child process and dispatches decoded frames to listeners.
 * Registered listeners receive frames for every session; ChatView filters by
 * its own sessionId. Callers should NOT hold references to live Agent/Context
 * data inside frames — only plain JSON leaves this module.
 */
export class DshMuxRelay {
  private child: ChildProcess | null = null;
  private baseUrl: string | null = null;
  private listeners = new Set<MuxRelayListener>();
  private stdoutBuf = "";

  /** Start the relay against a live dsh web base URL (idempotent). */
  start(baseUrl: string): void {
    if (this.child && this.baseUrl === baseUrl) return;
    this.stop();
    this.baseUrl = baseUrl;
    const script = relayScript(baseUrl);
    const args = ["-e", script];
    // node ships with Obsidian's Electron on every installation.
    this.child = spawn("node", args, { windowsHide: true });
    const c = this.child;
    c.stdout?.on("data", (d: Buffer) => this.handleData(d.toString()));
    c.stderr?.on("data", () => {
      /* diagnostics only; never surface in the UI */
    });
    c.on("close", () => {
      if (this.child === c) this.child = null;
    });
    c.on("error", () => {
      if (this.child === c) this.child = null;
    });
  }

  /** Register a frame listener; returns an unsubscribe function. */
  onFrame(listener: MuxRelayListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Is a relay child alive and wired to a base URL? */
  isActive(): boolean {
    return !!this.child && !!this.baseUrl;
  }

  /** Stop the relay child (idempotent). */
  stop(): void {
    const c = this.child;
    this.child = null;
    this.baseUrl = null;
    this.listeners.clear();
    if (!c) return;
    if (process.platform === "win32" && c.pid) {
      try {
        require("child_process").exec("taskkill /pid " + c.pid + " /T /F", () => {});
      } catch {
        /* ignore */
      }
    } else {
      c.kill();
    }
  }

  private handleData(text: string): void {
    this.stdoutBuf += text;
    let i: number;
    while ((i = this.stdoutBuf.indexOf("\n")) !== -1) {
      const line = this.stdoutBuf.slice(0, i);
      this.stdoutBuf = this.stdoutBuf.slice(i + 1);
      if (!line.startsWith("@")) continue;
      try {
        const raw = JSON.parse(line.slice(1)) as {
          type?: string;
          rpcId?: string;
          method?: string;
          payload?: unknown;
        };
        const frame = this.normalize(raw);
        if (frame) this.emit(frame);
      } catch {
        /* malformed frame — drop */
      }
    }
  }

  /** The child prints `server-request` full-form; unwrap into a RelayFrame. */
  private normalize(
    raw: { type?: string; rpcId?: string; method?: string; payload?: unknown }
  ): RelayFrame | null {
    if (raw.type !== "server-request") return null;
    const payload = (raw.payload ?? {}) as Record<string, unknown>;
    const method = raw.method ?? payload.type;
    const rpcId = raw.rpcId ?? "";
    if (method === "approval/requested") {
      return {
        type: "approval/requested",
        rpcId,
        sessionId: String(payload.sessionId ?? ""),
        approvalId: String(payload.approvalId ?? ""),
        toolName: String(payload.toolName ?? ""),
        callId: typeof payload.callId === "string" ? payload.callId : undefined,
        reason: typeof payload.reason === "string" ? payload.reason : undefined,
      };
    }
    if (method === "approval/resolved") {
      const out = String(payload.outcome ?? "");
      const outcome = (
        ["allowed-once", "rejected", "cancelled", "unavailable"] as const
      ).includes(out as "allowed-once")
        ? (out as "allowed-once" | "rejected" | "cancelled" | "unavailable")
        : ("unavailable" as const);
      return {
        type: "approval/resolved",
        sessionId: String(payload.sessionId ?? ""),
        approvalId: String(payload.approvalId ?? ""),
        outcome,
      };
    }
    if (method === "question/requested") {
      const qs = Array.isArray(payload.questions) ? payload.questions : [];
      return {
        type: "question/requested",
        rpcId,
        sessionId: String(payload.sessionId ?? ""),
        questions: qs.map((q) => {
          const item = q as {
            id?: string;
            question?: string;
            detail?: string;
            header?: string;
            options?: Array<{ label?: string; description?: string }>;
            multiSelect?: boolean;
          };
          return {
            id: String(item.id ?? ""),
            question: String(item.question ?? ""),
            detail: item.detail === undefined ? undefined : String(item.detail),
            header: item.header === undefined ? undefined : String(item.header),
            options: (item.options ?? []).map((o) => ({
              label: String(o.label ?? ""),
              ...(o.description === undefined ? {} : { description: String(o.description) }),
            })),
            multiSelect: item.multiSelect === true,
          };
        }),
      };
    }
    if (method === "question/resolved") {
      return {
        type: "question/resolved",
        sessionId: String(payload.sessionId ?? ""),
        questionRpcId: String(payload.questionRpcId ?? ""),
        outcome: payload.outcome === "answered" ? "answered" : "cancelled",
      };
    }
    if (method === "session/event") {
      const ev = (payload.event ?? {}) as Record<string, unknown>;
      return {
        type: "session/event",
        sessionId: String(payload.sessionId ?? ""),
        event: {
          seq: typeof ev.seq === "number" ? ev.seq : undefined,
          type: typeof ev.type === "string" ? ev.type : undefined,
          data: (ev.data ?? {}) as Record<string, unknown>,
        },
      };
    }
    if (method === "stream/error") {
      const e = (payload.error ?? {}) as { code?: string; message?: string };
      return {
        type: "stream/error",
        error: {
          code: typeof e.code === "string" ? e.code : undefined,
          message: typeof e.message === "string" ? e.message : "dsh mux stream error",
        },
      };
    }
    return null;
  }

  private emit(frame: RelayFrame): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(frame);
      } catch {
        /* listener must never break the relay */
      }
    }
  }
}
