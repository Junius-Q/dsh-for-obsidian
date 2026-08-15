import { ChildProcess } from "child_process";
import { requestUrl } from "obsidian";
import { spawnDsh } from "./spawnDsh";
import type { ObsidianDshSettings } from "../settings";

/**
 * Manages a resident local `dsh --profile web` process.
 *
 * To avoid piling up a brand-new orphaned process on every plugin reload, the
 * host prefers a FIXED loopback port (settings.httpPort, default 3080) and
 * REUSES an already-listening dsh instance on that port when one exists — only
 * spawning a child when nothing usable is listening there yet. When no fixed
 * port is configured (0) it falls back to the old OS-chosen random-port
 * behaviour (start a fresh process every time).
 *
 * "Adopted" hosts are external processes we did NOT spawn: we reuse their base
 * URL but never kill them on stop().
 */
export class DshHostManager {
  private child: ChildProcess | null = null;
  private baseUrl: string | null = null;
  /** True when we adopted an already-running host (no child owned by us). */
  private adopted = false;
  private awaitingStart: Array<{
    resolve: (url: string) => void;
    reject: (e: Error) => void;
    finish?: (fn?: () => void) => void;
  }> = [];
  private stdoutBuf = "";
  private probing = false;

  constructor(private getSettings: () => ObsidianDshSettings) {}

  /** Whether a host is currently usable (adopted or self-spawned). */
  isRunning(): boolean {
    return !!this.baseUrl && (this.adopted || !!this.child);
  }

  /** The base URL of the usable host, or null. */
  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  /** Resolve the fixed port from settings (0 disables fixed-port reuse). */
  private desiredPort(): number {
    const p = this.getSettings().httpPort;
    return Number.isInteger(p) && p > 0 ? p : 0;
  }

  /**
   * Ensure a usable host, returning its base URL.
   * 1) reuse our own running child; 2) adopt an instance already listening on
   * the fixed port; 3) spawn a fresh one (fixed port, else random).
   */
  async ensureStarted(timeoutMs = 30000): Promise<string> {
    if (this.isRunning() && this.baseUrl) return this.baseUrl;

    return new Promise<string>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        const i = this.awaitingStart.findIndex((w) => w.finish === finish);
        if (i !== -1) this.awaitingStart.splice(i, 1);
        fn();
      };
      const waiter = {
        finish,
        resolve: (url: string) => finish(() => resolve(url)),
        reject: (e: Error) => finish(() => reject(e)),
      };
      this.awaitingStart.push(waiter);
      timer = setTimeout(() => {
        if (!done) {
          waiter.reject(
            new Error(`Timed out waiting for dsh web to start after ${timeoutMs}ms`)
          );
        }
      }, timeoutMs);

      void (async () => {
        // (1) already usable?
        if (this.isRunning() && this.baseUrl) {
          waiter.resolve(this.baseUrl);
          return;
        }
        // (2) something already listening on our fixed port?
        const port = this.desiredPort();
        if (port > 0 && !this.child && !this.probing) {
          const adoptedUrl = await this.tryAdopt(port);
          if (adoptedUrl) {
            this.baseUrl = adoptedUrl;
            this.adopted = true;
            const waiters = this.awaitingStart;
            this.awaitingStart = [];
            waiters.forEach((w) => w.resolve(adoptedUrl));
            return;
          }
        }
        // (3) nothing usable — spawn.
        if (!this.child) void this.start();
      })();
    });
  }

  /**
   * Probe an existing dsh web listener on `port` and adopt it if it answers
   * like a live dsh host. Uses Obsidian's requestUrl (bypasses CSP).
   */
  private async tryAdopt(port: number): Promise<string | null> {
    this.probing = true;
    try {
      const res = await requestUrl({
        url: `http://127.0.0.1:${port}/api/host.describe`,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({
          type: "client-request",
          rpcId: "adopt-" + Math.random().toString(36).slice(2, 10),
          method: "host.describe",
          payload: {},
        }),
        throw: false,
      });
      if (res.status >= 200 && res.status < 300) {
        const parsed = JSON.parse(res.text);
        if (parsed?.result?.ok === true) {
          return `http://127.0.0.1:${port}`;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      this.probing = false;
    }
  }

  /** Stop the host. Adopted (external) hosts are left running — we only kill a child we spawned. */
  stop(): void {
    if (this.adopted) {
      // We reused an external process — do not kill it, just drop our refs.
      this.adopted = false;
      this.baseUrl = null;
      this.awaitingStart.forEach((w) => w.reject(new Error("dsh host stopped")));
      this.awaitingStart = [];
      return;
    }
    const child = this.child;
    this.child = null;
    this.baseUrl = null;
    this.awaitingStart.forEach((w) => w.reject(new Error("dsh host stopped")));
    this.awaitingStart = [];
    if (!child) return;
    if (process.platform === "win32" && child.pid) {
      try {
        require("child_process").exec(`taskkill /pid ${child.pid} /T /F`, () => {});
      } catch {
        /* ignore */
      }
    } else {
      child.kill();
    }
  }

  /**
   * Release our reference to the spawned dsh web process WITHOUT killing it, so
   * it keeps running and a later reload can adopt it via the fixed port. Only
   * safe when a fixed port is configured (the process must be reachable again).
   */
  detach(): void {
    const child = this.child;
    this.child = null;
    this.baseUrl = null;
    this.adopted = false;
    this.awaitingStart.forEach((w) => w.reject(new Error("dsh host detached")));
    this.awaitingStart = [];
    // Intentionally do NOT kill `child`.
    void child;
  }

  private async start(): Promise<void> {
    const settings = this.getSettings();
    this.stdoutBuf = "";
    const port = this.desiredPort();

    const args = ["--profile", "web", "--host", "127.0.0.1"];
    args.push("--port", port > 0 ? String(port) : "0");
    args.push("--trusted-host", "127.0.0.1");

    const child = spawnDsh(settings.dshExecutable.trim() || "dsh", args, {
      cwd: settings.workingDir || undefined,
    });
    this.child = child;

    child.stdout?.on("data", (d: Buffer) => {
      this.stdoutBuf += d.toString();
      this.tryExtractUrl();
    });
    child.stderr?.on("data", (d: Buffer) => {
      this.stdoutBuf += d.toString();
      this.tryExtractUrl();
    });
    child.on("error", (err) => {
      if (this.child === child) this.child = null;
      this.failWaiters(new Error(`Failed to start dsh web: ${err.message}`));
    });
    child.on("close", (code) => {
      if (this.child === child) this.child = null;
      this.failWaiters(new Error(`dsh web exited unexpectedly (code ${code})`));
    });
  }

  /** Parse `dsh web: http://host:port` from accumulated output. */
  private tryExtractUrl(): void {
    if (this.baseUrl) return;
    const m = /https?:\/\/([0-9.]+|localhost):(\d+)/.exec(this.stdoutBuf);
    if (m) {
      this.baseUrl = `http://127.0.0.1:${m[2]}`;
      const waiters = this.awaitingStart;
      this.awaitingStart = [];
      waiters.forEach((w) => w.resolve(this.baseUrl!));
    }
  }

  private failWaiters(err: Error): void {
    const waiters = this.awaitingStart;
    this.awaitingStart = [];
    waiters.forEach((w) => w.reject(err));
  }
}
