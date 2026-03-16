// apps/web/lib/codebase-tools.ts
// Codebase file access with path security for agent tools.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, relative, isAbsolute, dirname } from "path";
import { execSync } from "child_process";

// Project root — Next.js runs from apps/web, so go up two levels
const PROJECT_ROOT = resolve(process.cwd(), "..", "..");

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
  if (isAbsolute(filePath)) return false;
  if (/^[A-Za-z]:/.test(filePath)) return false;
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
  if (!isPathAllowed(filePath)) {
    return { ok: false, error: `Access denied: ${filePath}` };
  }

  const fullPath = resolve(PROJECT_ROOT, filePath);
  const rel = relative(PROJECT_ROOT, fullPath);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: "Path escapes project root" };
  }

  return { ok: true, path: fullPath };
}

// ─── File Operations ────────────────────────────────────────────────────────

export function readProjectFile(
  filePath: string,
  options?: { startLine?: number; endLine?: number },
): { content: string } | { error: string } {
  const resolved = resolveSafePath(filePath);
  if (!resolved.ok) return { error: resolved.error };

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

export function searchProjectFiles(
  query: string,
  options?: { glob?: string; maxResults?: number },
): { results: Array<{ path: string; line: number; text: string }> } | { error: string } {
  const max = options?.maxResults ?? 20;

  try {
    const args = ["-rn", "--max-count", String(max)];
    if (options?.glob) args.push("--include", options.glob);
    args.push(query, ".");

    const output = execSync(
      `grep ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`,
      {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );

    const results: Array<{ path: string; line: number; text: string }> = [];
    for (const line of output.split("\n").slice(0, max)) {
      const match = line.match(/^\.[\\/](.+?):(\d+):(.*)$/);
      if (match) {
        const [, path, lineNum, text] = match;
        if (path && lineNum && isPathAllowed(path)) {
          results.push({ path, line: parseInt(lineNum, 10), text: text?.trim() ?? "" });
        }
      }
    }

    return { results };
  } catch {
    return { results: [] };
  }
}

export function writeProjectFile(
  filePath: string,
  content: string,
): { ok: true } | { error: string } {
  const resolved = resolveSafePath(filePath);
  if (!resolved.ok) return { error: resolved.error };

  try {
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
