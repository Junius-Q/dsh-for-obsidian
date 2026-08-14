import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Read/write the DeepSeek API key inside dsh's own credentials file
 * (~/.dsh/.credentials.yaml). The plugin stores nothing itself — it only edits
 * the same YAML that dsh (and the dsh web UI) read, so a key entered here works
 * everywhere, just like entering it in the web UI.
 */

const KEY_NAME = "DEEPSEEK_API_KEY";

// Support DSH_HOME override, falling back to the default ~/.dsh.
function dshHomeDir(): string {
  const home = (process.env.DSH_HOME || "").trim();
  if (home) return home;
  return path.join(os.homedir(), ".dsh");
}

export function credentialsPath(): string {
  return path.join(dshHomeDir(), ".credentials.yaml");
}

/** Returns the stored DeepSeek key, or null when absent/unreadable. */
export function getStoredKey(): string | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), "utf8");
    const m = new RegExp(`^\\s*${KEY_NAME}\\s*:\\s*(.+)\\s*$`, "m").exec(raw);
    if (!m) return null;
    const v = m[1].trim();
    if (!v || v === "''" || v === '""') return null;
    return stripQuotes(v);
  } catch {
    return null;
  }
}

/** Returns true if a non-empty DeepSeek key is configured. */
export function isKeyConfigured(): boolean {
  return !!getStoredKey();
}

/**
 * Set (or remove) the DeepSeek key in the credentials file. Writing a falsy
 * value removes the line. Returns true on success.
 */
export function setStoredKey(key: string | null): boolean {
  try {
    const p = credentialsPath();
    ensureFile(p);
    let raw = fs.readFileSync(p, "utf8");

    const re = new RegExp(`^\\s*${KEY_NAME}\\s*:\\s*.*$`, "m");
    const value = key && key.trim() ? quoteKey(key.trim()) : null;

    if (re.test(raw)) {
      if (value === null) {
        // Remove the whole line (and its comment) for that key.
        raw = raw.replace(re, "").replace(/^\s*\n/gm, "");
      } else {
        raw = raw.replace(re, `${KEY_NAME}: ${value}`);
      }
    } else if (value !== null) {
      const line = `${KEY_NAME}: ${value}\n`;
      raw = raw.endsWith("\n") || raw === "" ? raw + line : raw + "\n" + line;
    }
    fs.writeFileSync(p, raw, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Ensure the parent dir and file exist. */
function ensureFile(p: string): void {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, "", "utf8");
}

/** Strip surrounding single/double quotes (YAML may quote the key). */
function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Quote a key value for YAML (if it contains special chars). */
function quoteKey(v: string): string {
  if (/[\s:#"'\\]/.test(v)) {
    // Escape backslashes and quotes, then double-quote.
    return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return v;
}
