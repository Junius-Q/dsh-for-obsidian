import { spawn } from "child_process";
import type { ObsidianDshSettings } from "../settings";

/**
 * Result of a single dsh headless invocation.
 */
export interface DshResult {
  /** The final assistant message (stdout, trimmed). */
  output: string;
  /** Stderr text, if any. */
  stderr: string;
  /** Process exit code. */
  exitCode: number | null;
}

/**
 * Bridge that spawns the `dsh --profile headless` CLI as a local subprocess.
 * Mirrors the approach of Claudian (spawn a local CLI agent), but uses dsh.
 */
export class DshBridge {
  private running = new Set<{ kill: () => void }>();

  constructor(private getSettings: () => ObsidianDshSettings) {}

  /**
   * Run one task via `dsh --profile <profile> "<task>"`.
   * Resolves with the printed final message.
   */
  run(task: string, opts?: { timeoutMs?: number }): Promise<DshResult> {
    const settings = this.getSettings();
    if (!task || !task.trim()) {
      return Promise.reject(new Error("Empty task"));
    }

    return new Promise<DshResult>((resolve, reject) => {
      const profile = settings.profile.trim() || "headless";
      const timeoutMs = opts?.timeoutMs ?? settings.timeoutMs;

      let stdout = "";
      let stderr = "";
      let settled = false;

      const child = spawn(
        settings.dshExecutable.trim() || "dsh",
        ["--profile", profile, task],
        {
          cwd: settings.workingDir || undefined,
          shell: process.platform === "win32",
          windowsHide: true,
        }
      );

      const handle = { kill: () => child.kill() };
      this.running.add(handle);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.running.delete(handle);
          child.kill();
          reject(new Error(`dsh call timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

      child.on("error", (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        this.running.delete(handle);
        reject(new Error(`Failed to spawn dsh: ${err.message}. Is dsh installed?`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        this.running.delete(handle);
        resolve({ output: stdout.trim(), stderr: stderr.trim(), exitCode: code });
      });
    });
  }

  /** Kill any in-flight dsh subprocesses (e.g. on chat stop / plugin unload). */
  abortAll(): void {
    for (const h of this.running) h.kill();
    this.running.clear();
  }
}
