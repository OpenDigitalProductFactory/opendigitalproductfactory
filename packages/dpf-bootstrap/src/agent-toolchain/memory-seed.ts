/**
 * Plan the kernel-tier memory seed for a contributor's local memory directory.
 *
 * The bootstrap projects the subset of `docs/founder-kernel/wiki/principles/`
 * that must fire reflexively on turn one (before any wiki_query MCP retrieval
 * completes). Commandment-tier principles are the default; an optional
 * recurring-failure-prevention set is available behind a flag.
 *
 * User-edited memory files (mtime newer than the install-time baseline) are
 * marked `preserve-user-edit` and never overwritten in this BI. A future BI
 * may add merge UX.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";

import type { PlanWriteMode } from "./types";

export type MemorySeedWrite = {
  path: string;
  content: string;
  mode: PlanWriteMode;
};

export type MemorySeedPlan = {
  writes: MemorySeedWrite[];
  /** Index file (MEMORY.md) entry written or refreshed. Null when no changes. */
  indexEntry: { path: string; content: string } | null;
  rationale: string;
};

export type PlanKernelMemorySeedOptions = {
  /** If true, only `principleTier: commandment` files are projected. */
  commandmentTierOnly?: boolean;
  /** ISO timestamp of the install-time baseline. mtime newer => user edit. */
  installTimeBaseline?: string;
  /** Caller-supplied FS shim for testability. */
  fs?: {
    readdirSync?: (path: string) => string[];
    readFileSync?: (path: string, encoding: BufferEncoding) => string;
    statSync?: (path: string) => { mtime: Date };
    existsSync?: (path: string) => boolean;
  };
};

type PrincipleFrontmatter = {
  title?: string;
  slug?: string;
  principleTier?: "commandment" | "core" | "contextual";
  principleDirection?: string;
};

/**
 * Tiny YAML frontmatter parser sized for our principle files. We only need
 * top-level scalar keys; principle frontmatter doesn't use nested mappings or
 * complex types in the bootstrap subset.
 */
function parsePrincipleFrontmatter(text: string): PrincipleFrontmatter {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out as PrincipleFrontmatter;
}

export function planKernelMemorySeed(
  kernelPrinciplesDir: string,
  contributorMemoryDir: string,
  projectSlug: string,
  options: PlanKernelMemorySeedOptions = {},
): MemorySeedPlan {
  const commandmentTierOnly = options.commandmentTierOnly === true;
  const baseline = options.installTimeBaseline
    ? new Date(options.installTimeBaseline).getTime()
    : 0;
  const fs = options.fs ?? {};
  const _readdir = fs.readdirSync ?? readdirSync;
  const _readFile = fs.readFileSync ?? (readFileSync as (p: string, e: BufferEncoding) => string);
  const _stat = fs.statSync ?? statSync;
  const _exists = fs.existsSync;

  const principleFiles = _readdir(kernelPrinciplesDir).filter((f: string) =>
    f.endsWith(".md"),
  );

  const writes: MemorySeedWrite[] = [];
  const indexLines: string[] = [];

  for (const file of principleFiles) {
    const srcPath = join(kernelPrinciplesDir, file);
    const text = _readFile(srcPath, "utf8");
    const fm = parsePrincipleFrontmatter(text);

    if (commandmentTierOnly && fm.principleTier !== "commandment") {
      continue;
    }

    const slug = fm.slug ?? basename(file, ".md");
    const destPath = join(contributorMemoryDir, projectSlug, `kernel_${slug}.md`);

    const content = renderMemoryFile(fm, slug);

    let mode: PlanWriteMode = "create";
    let skipBecauseUnchanged = false;
    // EAFP: read the destination file directly instead of using an existsSync
    // guard before readFileSync. The existsSync→readFileSync pattern is a TOCTOU
    // (time-of-check-time-of-use) race condition that CodeQL flags as a
    // potential security vulnerability (even in non-server contexts, it's still
    // correct to prefer atomic-ish reads). If the file is absent, readFileSync
    // throws and the catch block keeps mode at "create".
    try {
      const existingContent = _readFile(destPath, "utf8");
      // File exists and is readable. Check mtime for user-edit detection.
      const mtime = _stat(destPath).mtime.getTime();
      if (baseline > 0 && mtime > baseline) {
        mode = "preserve-user-edit";
      } else if (existingContent === content) {
        // Phase 6 idempotence: content already matches — skip the write.
        skipBecauseUnchanged = true;
        mode = "update";
      } else {
        mode = "update";
      }
    } catch {
      // File absent or unreadable — default "create" mode applies.
    }

    if (mode === "preserve-user-edit") {
      // Don't emit a write — but still index it.
      indexLines.push(`- [kernel: ${fm.title ?? slug}](kernel_${slug}.md) — user-edited, preserved`);
      continue;
    }

    if (skipBecauseUnchanged) {
      // Already converged; index it but emit no write.
      indexLines.push(`- [kernel: ${fm.title ?? slug}](kernel_${slug}.md) — tier: ${fm.principleTier ?? "unknown"}`);
      continue;
    }

    writes.push({ path: destPath, content, mode });
    indexLines.push(`- [kernel: ${fm.title ?? slug}](kernel_${slug}.md) — tier: ${fm.principleTier ?? "unknown"}`);
  }

  const indexContent =
    `# Kernel principles (auto-seeded by dpf-bootstrap-agent-toolchain)\n\n` +
    `These principles must fire before any MCP retrieval round-trip completes.\n` +
    `Do not edit in place — edit the canonical kernel page and re-run the bootstrap.\n\n` +
    indexLines.join("\n") +
    "\n";
  const indexPath = join(contributorMemoryDir, projectSlug, "MEMORY.md");

  // Phase 6: only emit the index when (a) we have writes to surface, OR
  // (b) the existing index content differs from what we'd write. The Phase 5
  // adapter rewrote the index on every run; Phase 6 makes that a noop too.
  let indexEntry: { path: string; content: string } | null = null;
  if (writes.length > 0) {
    indexEntry = { path: indexPath, content: indexContent };
  } else if (_exists && _exists(indexPath)) {
    try {
      const existingIndex = _readFile(indexPath, "utf8");
      if (existingIndex !== indexContent) {
        indexEntry = { path: indexPath, content: indexContent };
      }
    } catch {
      indexEntry = { path: indexPath, content: indexContent };
    }
  } else {
    // No writes and no existing index — first-run, index alongside the seeds.
    // But writes.length === 0 means there were no seeds either; still emit
    // the index for diagnostics (it lists the principles we considered).
    indexEntry = { path: indexPath, content: indexContent };
  }

  const rationale =
    writes.length === 0
      ? `Kernel memory already converged for ${projectSlug} (${indexLines.length} principles indexed).`
      : `Seeding ${writes.length} kernel principle(s) into ${projectSlug} (${commandmentTierOnly ? "commandment-only" : "full subset"}).`;

  return {
    writes,
    indexEntry,
    rationale,
  };
}

function renderMemoryFile(fm: PrincipleFrontmatter, slug: string): string {
  const title = fm.title ?? slug;
  const direction = fm.principleDirection ?? "";
  const tier = fm.principleTier ?? "unknown";
  return (
    `---\n` +
    `type: feedback\n` +
    `kernel-tier: ${tier}\n` +
    `slug: ${slug}\n` +
    `---\n` +
    `\n` +
    `# ${title}\n` +
    `\n` +
    `${direction}\n` +
    `\n` +
    `Source: docs/founder-kernel/wiki/principles/${slug}.md (canonical). Do not edit here.\n`
  );
}
