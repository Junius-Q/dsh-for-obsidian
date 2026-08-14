import { ChildProcess } from "child_process";
import { spawnDsh } from "./spawnDsh";
import type { ObsidianDshSettings } from "../settings";

/**
 * Manages a resident local `dsh --profile web` process. The plugin spawns the
 * dsh HTTP service on 127.0.0.1 (OS-chosen random port), waits until dsh prints
 * its URL, and exposes the base URL for a HTTP client to talk to.
 */
export class DshHostManager {
  private child: ChildProcess | null = null;
  private baseUrl: string | null = null;
  private awaitingStart: Array<{
    resolve: (url: string) => void;
    reject: (e: Error) => void;
    finish?: (fn?: () => void) => void;
  }> = [];
  private stdoutBuf = "";
  private hadOutput = false;

  constructor(private getSettings: () => ObsidianDshSettings) {}

  /** Whether a host process is currently alive and has advertised a URL. */
  isRunning(): boolean {
    return !!this.child && this.baseUrl !== null;
  }

  /** The base URL of the running host, or null if not running. */
  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  /**
   * Ensure the host is running, returning its base URL.
   * If already running, resolves immediately with the cached URL.
   * Rejects if the URL isn't advertised within `timeoutMs`.
   */
  async ensureStarted(timeoutMs = 30000): Promise<string> {
    if (this.isRunning() && this.baseUrl) return this.baseUrl;
    // Queue a waiter, then arm a timeout so we never hang forever if the host
    // spawns but never advertises a URL.
    return new Promise<string>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        // remove this waiter from the queue
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
          const err = new Error(`Timed out waiting for dsh web to start after ${timeoutMs}ms`);
          waiter.reject(err);
        }
      }, timeoutMs);

      // If no child is running yet, kick off the spawn now.
      if (!this.child && !this.isRunning()) {
        void this.start();
      }
    });
  }

  /** Stop the host process if running. */
  stop(): void {
    const child = this.child;
    this.child = null;
    this.baseUrl = null;
    this.awaitingStart.forEach((w) => w.reject(new Error("dsh host stopped")));
    this.awaitingStart = [];
    if (!child) return;
    if (process.platform === "win32" && child.pid) {
      // On Windows we spawn via cmd.exe; killing only cmd leaves the dsh node
      // child orphaned. Use taskkill to kill the whole process tree.
      try {
        require("child_process").exec(
          `taskkill /pid ${child.pid} /T /F`,
          () => {}
        );
      } catch {
        /* ignore */
      }
    } else {
      child.kill();
    }
  }

  private async start(): Promise<void> {
    const settings = this.getSettings();
    this.stdoutBuf = "";
    this.hadOutput = false;

    const child = spawnDsh(
      settings.dshExecutable.trim() || "dsh",
      ["--profile", "web", "--host", "127.0.0.1", "--port", "0", "--trusted-host", "127.0.0.1"],
      {
        cwd: settings.workingDir || undefined,
      }
    );
    this.child = child;

    child.stdout?.on("data", (d: Buffer) => {
      this.hadOutput = true;
      this.stdoutBuf += d.toString();
      this.tryExtractUrl();
    });
    child.stderr?.on("data", (d: Buffer) => {
      this.hadOutput = true;
      this.stdoutBuf += d.toString();
      this.tryExtractUrl();
    });
    child.on("error", (err) => {
      this.child = null;
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
