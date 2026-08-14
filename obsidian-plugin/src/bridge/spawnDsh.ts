import { spawn, SpawnOptions } from "child_process";

/**
 * Spawn the dsh CLI robustly across platforms.
 *
 * On Windows the npm shim is a `.cmd` batch file, which is executed via
 * `cmd.exe` (a raw `spawn("dsh.cmd", …)` fails with EINVAL). We therefore run
 * Windows commands through `cmd.exe /d /s /c` with the target command quoted.
 * On POSIX we spawn the command directly with an args array.
 */
export function spawnDsh(
  exe: string,
  args: string[],
  opts: SpawnOptions = {}
) {
  const command = exe.trim() || "dsh";
  if (process.platform === "win32") {
    // cmd.exe resolves unquoted PATH commands (like `dsh.cmd`) fine, but will
    // NOT resolve a quoted command name. So we quote only the args.
    const cmdLine = `${command} ${args.map((a) => quoteCmdToken(a)).join(" ")}`.trim();
    return spawn("cmd.exe", ["/d", "/s", "/c", cmdLine], {
      windowsHide: true,
      ...opts,
    });
  }
  return spawn(command, args, { windowsHide: true, ...opts });
}

/** Quote a token that may contain spaces / backslashes for cmd.exe. */
function quoteCmdToken(token: string): string {
  // Simple tokens need no quoting.
  if (!/[ \t"\\]/.test(token)) return token;
  // Escape trailing backslashes and embedded quotes the way cmd expects.
  const escaped = token.replace(/\\+(?="|$)/g, "\\$&").replace(/"/g, '\\"');
  return `"${escaped}"`;
}
