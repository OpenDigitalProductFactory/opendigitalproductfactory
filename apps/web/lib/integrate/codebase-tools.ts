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

import { lazyFs as getFs, lazyPath as getPath, lazyChildProcess } from "@/lib/shared/lazy-node";

function getProjectRoot(): string {
  const path = getPath();
  if (process.env.PROJECT_ROOT) return path.resolve(process.env.PROJECT_ROOT);
  return path.resolve(process.cwd(), "..", "..");
}

// ─── Path Security ──────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /^\.env/i,
  /\.env\./i,
  /\.env$/i,
  /\.key$/i,
  /\.pem$/i,
  /\.p12$/i,
  /^credentials/i,
  /^secrets/i,
  /[\\/]\.git[\\/]/,
  /^\.git[\\/]/,
  /^\.git$/,
  /[\\/]node_modules[\\/]/,
  /^node_modules[\\/]/,
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
  const max = options?.maxResults ?? 20;

  try {
    const { execSync } = lazyChildProcess();
    const projectRoot = getProjectRoot();
    const globArg = options?.glob ? `-- "${options.glob}"` : "";
    const output = execSync(
      `git grep -n --max-count=${max} ${JSON.stringify(query)} HEAD ${globArg}`.trim(),
      {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );

    const results: Array<{ path: string; line: number; text: string }> = [];
    for (const line of output.split("\n").slice(0, max)) {
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
    return { results: [] };
  }
}

export async function listProjectDirectory(
  dirPath: string,
  _options?: { maxDepth?: number },
): Promise<{ entries: Array<{ name: string; type: "file" | "dir"; path: string }> } | { error: string }> {
  if (!isDevInstance()) return { error: DEV_ONLY_ERROR };
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
