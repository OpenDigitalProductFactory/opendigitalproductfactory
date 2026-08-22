// apps/web/lib/codebase-tools.ts
// Codebase file access with path security for agent tools.
// Only available on dev instances (INSTANCE_TYPE=dev). Production has no source code.
//
// All fs/path/child_process usage goes through lazy-node helpers which hide
// require() from Turbopack/NFT static analysis via new Function().
// This prevents whole-project tracing during production builds.

// ─── Instance Type ──────────────────────────────────────────────────────────

/** Returns true if this is a development instance with source code access. */
export function isDevInstance(): boolean {
  const instanceType = process.env.INSTANCE_TYPE;
  if (instanceType === "dev") return true;
  if (instanceType === "production") return false;
  return process.env.NODE_ENV !== "production";
}

const DEV_ONLY_ERROR = "Codebase access is only available on dev instances. Production does not have source code.";

import {
  lazyFs as getFs,
  lazyFsPromises as getFsPromises,
  lazyPath as getPath,
  lazyExec,
  getCwd,
} from "@/lib/shared/lazy-node";

/**
 * Where this install's source checkout lives, if it has one. Exported so any
 * surface that needs to READ cited source (e.g. decision evidence
 * re-verification) resolves it here rather than re-deriving the path — one home
 * for "where is the source", alongside `isDevInstance` and `isPathAllowedSync`.
 */
export function getProjectRoot(): string {
  const path = getPath();
  if (process.env.PROJECT_ROOT) return path.resolve(process.env.PROJECT_ROOT);
  return path.resolve(getCwd(), "..", "..");
}

// ─── Root sanity (BI-6CFC5429) ──────────────────────────────────────────────
//
// PROJECT_ROOT is an env var, so a misconfigured deployment silently points
// every agent codebase tool at the wrong tree. Not hypothetical: on 2026-08-19
// the live portal had PROJECT_ROOT=/workspace resolving to a volume pinned at a
// 2026-06-08 commit on a stray branch holding 4,444 of the repo's ~10,000
// files. `search_project_files` and `list_project_directory` returned
// `success=true` with EMPTY results for files that plainly existed, the Build
// Studio ideate agent looped searching for its own target file, and the
// operator was shown "the local AI wasn't strong enough — connect a stronger
// provider." An environment variable was surfaced as a model-capability
// problem, which is the worst possible misattribution.
//
// A wrong root cannot be auto-corrected here — only the operator knows which
// tree is intended — but it must be LOUD rather than silent. These sentinels
// are workspace-defining entries present at the root of any DPF checkout.

const ROOT_SENTINELS = ["pnpm-workspace.yaml", "apps/web"] as const;

let rootWarningEmitted = false;

/**
 * True when the resolved project root looks like a DPF checkout. Exported for
 * the boot check and for tests.
 */
export function projectRootLooksValid(root: string = getProjectRoot()): boolean {
  try {
    const fs = getFs();
    const path = getPath();
    return ROOT_SENTINELS.every((sentinel) => fs.existsSync(path.join(root, sentinel)));
  } catch {
    // A probe failure is not proof of a bad root — stay quiet rather than cry wolf.
    return true;
  }
}

/**
 * Warn ONCE per process when the resolved root fails the sentinel check, so an
 * empty search result is traceable to the root rather than read as "this code
 * does not exist". Advisory only — it never blocks a read.
 */
export function warnIfProjectRootSuspect(): void {
  if (rootWarningEmitted) return;
  rootWarningEmitted = true;
  const root = getProjectRoot();
  if (projectRootLooksValid(root)) return;
  console.warn(
    "[codebase-tools] PROJECT_ROOT=%s does not look like a DPF checkout (missing %s). "
    + "Agent code search will return EMPTY results for files that DO exist. "
    + "Empty results from this root are not evidence the code is absent (BI-6CFC5429).",
    JSON.stringify(root),
    JSON.stringify(ROOT_SENTINELS.join(", ")),
  );
}

/** Test seam: reset the once-per-process warning latch. */
export function resetProjectRootWarningForTests(): void {
  rootWarningEmitted = false;
}

// ─── Path Security ──────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /^\.env/i,
  /\.env\./i,
  /\.env$/i,
  /\.key$/i,
  /\.pem$/i,
  /\.p12$/i,
  // Block `credentials` and `secrets` whether they appear at the start
  // of the path or as any path component — start-anchored `/^secrets/i`
  // silently allowed nested `config/secrets/admin.json` through, which
  // defeated the intent. The trailing class `(?:[\\/.]|$)` keeps the
  // pattern from false-matching legitimate directory names that merely
  // share a prefix (`secrets-management`, `credentials-rotation`).
  /(?:^|[\\/])credentials(?:[\\/.]|$)/i,
  /(?:^|[\\/])secrets(?:[\\/.]|$)/i,
  /[\\/]\.git[\\/]/,
  /^\.git[\\/]/,
  /^\.git$/,
  /[\\/]node_modules[\\/]/,
  /^node_modules[\\/]/,
  /[\\/]\.pnpm-store[\\/]/,
  /^\.pnpm-store[\\/]/,
  /^packages[\\/]db[\\/]generated(?:[\\/]|$)/,
];

export function isPathAllowed(filePath: string): boolean {
  const path = getPath();
  if (path.isAbsolute(filePath)) return false;
  if (/^[A-Za-z]:/.test(filePath)) return false;
  if (filePath.includes("..")) return false;

  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) return false;
  }

  return true;
}

export function isPathAllowedSync(filePath: string): boolean {
  if (/^[/\\]/.test(filePath) || /^[A-Za-z]:/.test(filePath)) return false;
  if (filePath.includes("..")) return false;

  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) return false;
  }

  return true;
}

type SafePathResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export function resolveSafePath(filePath: string): SafePathResult {
  if (!isPathAllowedSync(filePath)) {
    return { ok: false, error: `Access denied: ${filePath}` };
  }

  const path = getPath();
  const projectRoot = getProjectRoot();
  const fullPath = path.resolve(projectRoot, filePath);
  const rel = path.relative(projectRoot, fullPath);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, error: "Path escapes project root" };
  }

  return { ok: true, path: fullPath };
}

// ─── File Operations ────────────────────────────────────────────────────────

export async function readProjectFile(
  filePath: string,
  options?: { startLine?: number; endLine?: number },
): Promise<{ content: string } | { error: string }> {
  if (!isDevInstance()) return { error: DEV_ONLY_ERROR };
  const resolved = resolveSafePath(filePath);
  if (!resolved.ok) return { error: resolved.error };

  const fs = getFs();
  if (!fs.existsSync(resolved.path)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    const content = fs.readFileSync(resolved.path, "utf-8");
    if (options?.startLine || options?.endLine) {
      const lines = content.split("\n");
      const start = (options.startLine ?? 1) - 1;
      const end = options.endLine ?? lines.length;
      return { content: lines.slice(start, end).join("\n") };
    }
    return { content };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Read error" };
  }
}

export async function searchProjectFiles(
  query: string,
  options?: { glob?: string; maxResults?: number },
): Promise<{ results: Array<{ path: string; line: number; text: string }> } | { error: string }> {
  if (!isDevInstance()) return { error: DEV_ONLY_ERROR };
  warnIfProjectRootSuspect();
  const max = options?.maxResults ?? 20;
  const projectRoot = getProjectRoot();

  // Use async exec via lazyExec — the synchronous variant (execSync) blocks
  // the Node main event loop on subprocess wait, which under a wedged 9P
  // bind mount parks the whole portal in kernel D state. See BI-6588414f
  // for the 2026-05-19 incident. The async path lets the event loop keep
  // serving HTTP, health checks, and the watchdog cron even if `git grep`
  // is itself stuck.
  try {
    const execAsync = lazyExec();
    const globArg = options?.glob ? `-- "${options.glob}"` : "";
    const { stdout } = await execAsync(
      `git grep -n --max-count=${max} ${JSON.stringify(query)} HEAD ${globArg}`.trim(),
      {
        cwd: projectRoot,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );

    const results: Array<{ path: string; line: number; text: string }> = [];
    for (const rawLine of stdout.split("\n")) {
      if (results.length >= max) break;
      const line = rawLine.replace(/\r$/, "");
      const match = line.match(/^(?:HEAD:)?(.+?):(\d+):(.*)$/);
      if (match) {
        const [, path, lineNum, text] = match;
        if (path && lineNum && isPathAllowedSync(path)) {
          results.push({ path, line: parseInt(lineNum, 10), text: text?.trim() ?? "" });
        }
      }
    }

    return { results };
  } catch {
    return fallbackSearchProjectFiles(projectRoot, query, options);
  }
}

function globMatches(filePath: string, glob?: string): boolean {
  if (!glob) return true;
  const normalized = glob.replace(/\\/g, "/");
  if (normalized.startsWith("*.")) return filePath.endsWith(normalized.slice(1));
  if (normalized.startsWith("**/*.")) return filePath.endsWith(normalized.slice(4));
  return filePath === normalized || filePath.endsWith(`/${normalized}`);
}

// CodeQL #73 (js/regex-injection): query is user-supplied and gets used
// as a regex by design (this is the search feature). The risk isn't
// pattern injection (that IS the feature) but ReDoS — a malicious
// pattern can stall the matcher.
//
// Defenses:
//   1. Length cap (200 chars) — bounds catastrophic-backtracking growth.
//   2. Fall back to substring match if the regex compile fails OR if the
//      pattern looks too aggressive (>4 `*`/`+` quantifiers).
function makeLineMatcher(query: string): (line: string) => boolean {
  const MAX_QUERY_LEN = 200;
  const MAX_QUANTIFIERS = 4;
  if (query.length > MAX_QUERY_LEN) {
    return (line) => line.includes(query.slice(0, MAX_QUERY_LEN));
  }
  const quantifierCount = (query.match(/[*+?]/g) ?? []).length;
  if (quantifierCount > MAX_QUANTIFIERS) {
    // Quantifier-heavy patterns are the classic ReDoS shape. Fall back
    // to substring search to keep the matcher bounded.
    return (line) => line.includes(query);
  }
  try {
    const pattern = new RegExp(query);
    return (line) => pattern.test(line);
  } catch {
    return (line) => line.includes(query);
  }
}

async function fallbackSearchProjectFiles(
  projectRoot: string,
  query: string,
  options?: { glob?: string; maxResults?: number },
): Promise<{ results: Array<{ path: string; line: number; text: string }> }> {
  const fsp = getFsPromises();
  const path = getPath();
  const max = options?.maxResults ?? 20;
  const matchesLine = makeLineMatcher(query);
  const results: Array<{ path: string; line: number; text: string }> = [];
  const skipDirs = new Set([".git", ".next", "node_modules", ".pnpm-store", "generated"]);

  async function visit(dir: string): Promise<void> {
    if (results.length >= max) return;
    let entries: import("fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= max) return;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
      if (!relPath || !isPathAllowedSync(relPath)) continue;
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !globMatches(relPath, options?.glob)) continue;

      let content: string;
      try {
        content = await fsp.readFile(fullPath, "utf-8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && results.length < max; i += 1) {
        if (matchesLine(lines[i] ?? "")) {
          results.push({ path: relPath, line: i + 1, text: (lines[i] ?? "").trim() });
        }
      }
    }
  }

  await visit(projectRoot);
  return { results };
}

export async function listProjectDirectory(
  dirPath: string,
  _options?: { maxDepth?: number },
): Promise<{ entries: Array<{ name: string; type: "file" | "dir"; path: string }> } | { error: string }> {
  if (!isDevInstance()) return { error: DEV_ONLY_ERROR };
  warnIfProjectRootSuspect();
  const safePath = dirPath === "" || dirPath === "." ? "." : dirPath;
  if (safePath !== "." && !isPathAllowedSync(safePath)) {
    return { error: `Access denied: ${safePath}` };
  }

  const path = getPath();
  const projectRoot = getProjectRoot();
  const fullPath = safePath === "." ? projectRoot : path.resolve(projectRoot, safePath);
  const fs = getFs();
  if (!fs.existsSync(fullPath)) {
    return { error: `Directory not found: ${safePath}` };
  }

  try {
    const items = fs.readdirSync(fullPath, { withFileTypes: true });
    const entries: Array<{ name: string; type: "file" | "dir"; path: string }> = [];

    for (const item of items) {
      const itemPath = safePath === "." ? item.name : `${safePath}/${item.name}`;
      if (!isPathAllowedSync(itemPath)) continue;
      if (item.name.startsWith(".")) continue;
      entries.push({
        name: item.name,
        type: item.isDirectory() ? "dir" : "file",
        path: itemPath,
      });
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { entries: entries.slice(0, 100) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Read error" };
  }
}

export async function writeProjectFile(
  filePath: string,
  content: string,
): Promise<{ ok: true } | { error: string }> {
  if (!isDevInstance()) return { error: DEV_ONLY_ERROR };
  const resolved = resolveSafePath(filePath);
  if (!resolved.ok) return { error: resolved.error };

  try {
    const fs = getFs();
    const path = getPath();

    // Verify the project root has source code — prevents silently writing to ephemeral container storage
    const projectRoot = getProjectRoot();
    if (!fs.existsSync(path.join(projectRoot, "package.json"))) {
      return { error: "Source code is not accessible from this environment. Mount the project source into the container (PROJECT_ROOT env var) or run the portal outside Docker." };
    }

    const dir = path.dirname(resolved.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved.path, content, "utf-8");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Write error" };
  }
}

export function generateSimpleDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  const maxLen = Math.max(oldLines.length, newLines.length);
  let chunkStart = -1;
  const chunks: Array<{ start: number; old: string[]; new: string[] }> = [];

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine !== newLine) {
      if (chunkStart === -1) chunkStart = i;
    } else if (chunkStart !== -1) {
      chunks.push({
        start: chunkStart,
        old: oldLines.slice(chunkStart, i),
        new: newLines.slice(chunkStart, i),
      });
      chunkStart = -1;
    }
  }
  if (chunkStart !== -1) {
    chunks.push({
      start: chunkStart,
      old: oldLines.slice(chunkStart),
      new: newLines.slice(chunkStart),
    });
  }

  for (const chunk of chunks) {
    diffLines.push(`@@ -${chunk.start + 1},${chunk.old.length} +${chunk.start + 1},${chunk.new.length} @@`);
    for (const line of chunk.old) diffLines.push(`-${line}`);
    for (const line of chunk.new) diffLines.push(`+${line}`);
  }

  return diffLines.join("\n");
}
