import { DshHostManager } from "./dshHost";

/**
 * Streams dsh session events over `ws://<host>/api/events.mux`.
 *
 * The mux is server->client only (sending a message gets the socket closed with
 * 1008). Frames are newline-delimited JSON of shape:
 *   {"type":"server-request","rpcId":"…","method":"<frameType>","payload":{…}}
 *
 * We use the browser-native `WebSocket` (available in the Obsidian/Electron
 * renderer), so no `ws` npm dependency or bundling is required.
 */

export interface MuxFrame {
  type: string;
  rpcId?: string;
  method?: string;
  payload?: Record<string, unknown>;
}

export type ChunkKind =
  | "text-delta"
  | "reasoning-delta"
  | "tool-call-delta"
  | "block-start"
  | "block-end"
  | "usage"
  | string;

export interface ChunkEvent {
  sessionId?: string;
  tag?: string;
  kind: ChunkKind;
  /** incremental text delta (for text-delta / reasoning-delta). */
  delta?: string;
  title?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
}

/** Callbacks for stream consumers. */
export interface StreamHandlers {
  onEvent: (chunk: ChunkEvent) => void;
  onMessage?: (payload: { event: unknown }) => void;
  onSubscribed?: (sessionId: string, lastSeq: number) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export class DshStreamClient {
  private ws: WebSocket | null = null;
  private buffer = "";

  constructor(
    private host: DshHostManager,
    private handlers: StreamHandlers
  ) {}

  /** Open the mux WebSocket. Resolves once open. */
  open(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.host.getBaseUrl();
      if (!url) return reject(new Error("dsh host not running"));
      const wsUrl = url.replace(/^http/, "ws") + "/api/events.mux";

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        return reject(e as Error);
      }
      this.ws = ws;

      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timed out opening dsh event stream"));
      }, timeoutMs);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onmessage = (ev) => this.handleMessage(ev.data as string);
      ws.onerror = () => {
        clearTimeout(timer);
        this.handlers.onError?.(new Error("dsh stream error"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        this.handlers.onClose?.();
      };
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close(1000, "bye");
      this.ws = null;
    }
  }

  private handleMessage(data: string): void {
    this.buffer += data;
    // Split on newlines; JSON frames may or may not end with one.
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      this.tryParseFrame(line);
    }
    // No newline remaining: maybe the frame arrived without a trailing \n.
    // If the whole buffer is one complete JSON object, parse and clear it.
    if (this.buffer.trim()) {
      const trimmed = this.buffer.trim();
      // Only attempt if it looks like a full object (cheap heuristic).
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          JSON.parse(trimmed);
          const line = trimmed;
          this.buffer = "";
          this.tryParseFrame(line);
        } catch {
          /* incomplete frame; keep buffering */
        }
      }
    }
  }

  private tryParseFrame(line: string): void {
    try {
      this.handleFrame(JSON.parse(line) as MuxFrame);
    } catch {
      /* ignore malformed frame */
    }
  }

  private handleFrame(frame: MuxFrame): void {
    if (frame.type !== "server-request" || !frame.method) return;
    switch (frame.method) {
      case "session/subscribed": {
        const p = frame.payload || {};
        const sid = String(p.sessionId || "");
        const lastSeq = Number(p.lastSeq || 0);
        this.handlers.onSubscribed?.(sid, lastSeq);
        break;
      }
      case "session/event": {
        const p = frame.payload || {};
        const event = p.event as unknown;
        const chunk = this.extractChunk(frame.payload);
        if (chunk) this.handlers.onEvent(chunk);
        else this.handlers.onMessage?.({ event });
        break;
      }
      default:
        break;
    }
  }

  /** Pull incremental text/usage out of a session/event frame. */
  private extractChunk(payload: Record<string, unknown> | undefined): ChunkEvent | null {
    if (!payload || typeof payload.event !== "object") return null;
    const event = payload.event as Record<string, unknown>;
    const evType = String(event.type || "");
    const data = (event.data || {}) as Record<string, unknown>;
    const base: ChunkEvent = {
      sessionId: payload.sessionId ? String(payload.sessionId) : undefined,
      kind: "",
    };

    if (evType === "assistant/chunk") {
      const chunk = (data.chunk || {}) as Record<string, unknown>;
      base.kind = String(chunk.type || "");
      // text-delta / reasoning-delta carry the increment in `text`.
      if ((chunk.type === "text-delta" || chunk.type === "reasoning-delta") && chunk.text !== undefined) {
        base.delta = String(chunk.text);
        base.kind = chunk.type as ChunkKind;
      }
      if (chunk.type === "usage") base.usage = chunk as ChunkEvent["usage"];
      if (chunk.title) base.title = String(chunk.title);
      return base;
    }

    if (evType === "assistant/message") {
      base.kind = "assistant/message";
      const usage = data.usage as Record<string, unknown> | undefined;
      if (usage) {
        base.usage = {
          inputTokens: Number(usage.inputTokens || 0),
          outputTokens: Number(usage.outputTokens || 0),
          cacheReadTokens: Number(usage.cacheReadTokens || 0),
          cacheWriteTokens: Number(usage.cacheWriteTokens || 0),
        };
      }
      return base;
    }

    // Other event types we don't synthesize a chunk for.
    return null;
  }
}
