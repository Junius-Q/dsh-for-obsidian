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
  private awaitingStart: Array<{ resolve: (url: string) => void; reject: (e: Error) => void }> = [];
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
   */
  async ensureStarted(timeoutMs = 30000): Promise<string> {
    if (this.isRunning() && this.baseUrl) return this.baseUrl;
    if (this.child) {
      // still starting — queue a waiter
      return new Promise<string>((resolve, reject) => this.awaitingStart.push({ resolve, reject }));
    }
    await this.start();
    return new Promise<string>((resolve, reject) => this.awaitingStart.push({ resolve, reject }));
  }

  /** Stop the host process if running. */
  stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.baseUrl = null;
    this.awaitingStart.forEach((w) => w.reject(new Error("dsh host stopped")));
    this.awaitingStart = [];
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
