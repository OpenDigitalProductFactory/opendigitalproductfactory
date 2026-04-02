// apps/web/lib/codebase-tools.ts
// Codebase file access with path security for agent tools.
// Only available on dev instances (INSTANCE_TYPE=dev). Production has no source code.
//
// All fs/path/child_process usage is behind dynamic import() to prevent
// Next.js NFT from tracing the entire project tree during production builds.

// ─── Instance Type ──────────────────────────────────────────────────────────

/** Returns true if this is a development instance with source code access. */
export function isDevInstance(): boolean {
  const instanceType = process.env.INSTANCE_TYPE;
  if (instanceType === "dev") return true;
  if (instanceType === "production") return false;
  return process.env.NODE_ENV !== "production";
}

const DEV_ONLY_ERROR = "Codebase access is only available on dev instances. Production does not have source code.";

async function getProjectRoot(): Promise<string> {
  const { resolve } = await import(/* turbopackIgnore: true */ "path");
  if (process.env.PROJECT_ROOT) return resolve(process.env.PROJECT_ROOT);
  return resolve(process.cwd(), "..", "..");
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

export async function isPathAllowed(filePath: string): Promise<boolean> {
  const { isAbsolute } = await import(/* turbopackIgnore: true */ "path");
  if (isAbsolute(filePath)) return false;
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

export async function resolveSafePath(filePath: string): Promise<SafePathResult> {
  if (!isPathAllowedSync(filePath)) {
    return { ok: false, error: `Access denied: ${filePath}` };
  }

  const { resolve, relative, isAbsolute } = await import(/* turbopackIgnore: true */ "path");
  const projectRoot = await getProjectRoot();
  const fullPath = resolve(projectRoot, filePath);
  const rel = relative(projectRoot, fullPath);

  if (rel.startsWith("..") || isAbsolute(rel)) {
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
  const resolved = await resolveSafePath(filePath);
  if (!resolved.ok) return { error: resolved.error };

  const { readFileSync, existsSync } = await import(/* turbopackIgnore: true */ "fs");
  if (!existsSync(resolved.path)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    const content = readFileSync(resolved.path, "utf-8");
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
    const { execSync } = await import(/* turbopackIgnore: true */ "child_process");
    const projectRoot = await getProjectRoot();
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

  const { resolve } = await import(/* turbopackIgnore: true */ "path");
  const projectRoot = await getProjectRoot();
  const fullPath = safePath === "." ? projectRoot : resolve(projectRoot, safePath);
  const { readdirSync, existsSync } = await import(/* turbopackIgnore: true */ "fs");
  if (!existsSync(fullPath)) {
    return { error: `Directory not found: ${safePath}` };
  }

  try {
    const items = readdirSync(fullPath, { withFileTypes: true });
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
  const resolved = await resolveSafePath(filePath);
  if (!resolved.ok) return { error: resolved.error };

  try {
    const { writeFileSync, existsSync, mkdirSync } = await import(/* turbopackIgnore: true */ "fs");
    const { dirname, join } = await import(/* turbopackIgnore: true */ "path");

    // Verify the project root has source code — prevents silently writing to ephemeral container storage
    const projectRoot = await getProjectRoot();
    if (!existsSync(join(projectRoot, "package.json"))) {
      return { error: "Source code is not accessible from this environment. Mount the project source into the container (PROJECT_ROOT env var) or run the portal outside Docker." };
    }

    const dir = dirname(resolved.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(resolved.path, content, "utf-8");
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
