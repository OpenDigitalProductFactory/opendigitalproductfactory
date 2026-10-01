#!/usr/bin/env node
// scripts/check-retired-substrate.mjs
//
// THE PROBLEM IT FIXES: a file can name a service the platform no longer runs,
// and nothing notices. BET-5 retired Neo4j and Qdrant onto PostgreSQL; the
// published platform overview kept presenting Neo4j as a live datastore, the
// disaster-recovery runbook kept telling operators, mid-incident, to run
// `restore-neo4j.sh` and `docker compose up -d postgres neo4j qdrant` against
// decommissioned containers, and env examples, dev containers, VS Code tasks,
// prompts, compose comments and dead code kept naming it for months.
//
// THE CONTRACT (forbid, not ratchet): no tracked file may name a retired term
// from scripts/retired-substrate.json unless it sits under one of the registry's
// `historicalRoots` or is listed in its `allowed` map. Both are closed lists and
// every entry carries a reason. The allowlist only shrinks: an entry whose file
// no longer names a retired term fails as stale until it is removed, so a fixed
// file cannot quietly regrow its mention. There is no --update: adding an entry
// is a reviewed edit with a reason, never a regenerated baseline.
//
// DELIBERATELY SCANS EVERYTHING TRACKED, fenced code blocks included. The most
// dangerous instance was a copy-pasteable command in an incident runbook; the
// most numerous were config and code nobody reads as documentation.
//
//   node scripts/check-retired-substrate.mjs
//
// Plan 2026-09-08 M9 (BI-B1977CEE) flipped this guard from a published-docs
// ratchet to a repo-wide forbid.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gitText } from "./lib/git.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = path.join(REPO_ROOT, "scripts", "retired-substrate.json");

// Binary or opaque formats a word search cannot read meaningfully.
const SKIPPED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".webm", ".mp3", ".mp4",
  ".woff", ".woff2", ".ttf", ".otf", ".zip", ".gz", ".tgz", ".docx", ".doc", ".xlsx",
  ".xls", ".pptx", ".odt", ".ods", ".rtf", ".onnx", ".wasm",
]);
const MAX_BYTES = 8 * 1024 * 1024;

function requireReasonMap(value, label) {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[retired-substrate] "${label}" must be an object of path -> reason`);
  }
  for (const [key, reason] of Object.entries(value)) {
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(`[retired-substrate] ${label} entry "${key}" has no reason`);
    }
  }
  return value;
}

/**
 * Parse the registry. Throws on an entry with no term or an allowlist entry
 * with no reason, rather than silently skipping it.
 */
export function loadRegistry(json) {
  const parsed = typeof json === "string" ? JSON.parse(json) : json;
  const entries = parsed.retired ?? [];
  for (const e of entries) {
    if (!e.term || typeof e.term !== "string") {
      throw new Error(`[retired-substrate] registry entry missing a "term": ${JSON.stringify(e)}`);
    }
  }
  const historicalRoots = requireReasonMap(parsed.historicalRoots, "historicalRoots");
  const allowed = requireReasonMap(parsed.allowed, "allowed");
  for (const root of Object.keys(historicalRoots)) {
    if (!root.endsWith("/")) {
      throw new Error(`[retired-substrate] historicalRoots entry "${root}" must end with "/"`);
    }
  }
  return { entries, historicalRoots, allowed };
}

/**
 * Find retired terms in `text`. Matches on word boundaries and
 * case-insensitively, so "Neo4j", "neo4j-driver" and "NEO4J_URL" all count —
 * a stale env var name is as misleading as stale prose.
 *
 * @returns {Array<{term: string, line: number}>} first hit per term, in registry order
 */
export function findRetiredMentions(text, entries) {
  const lines = text.split("\n");
  const hits = [];
  for (const { term } of entries) {
    // Escape regex metacharacters, then bound on a non-alphanumeric char or a
    // string edge. `_` is deliberately a BOUNDARY, not part of the word: a file
    // telling you to set NEO4J_URL is exactly as stale as one telling you to
    // start the container. Requiring a non-alphanumeric on both sides still
    // keeps "neo4jsomething" from firing.
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^A-Za-z0-9])${safe}([^A-Za-z0-9]|$)`, "i");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ term, line: i + 1 });
        break;
      }
    }
  }
  return hits;
}

export function isUnderHistoricalRoot(filePath, historicalRoots) {
  return Object.keys(historicalRoots).some((root) => filePath.startsWith(root));
}

export function isScannable(filePath) {
  return !SKIPPED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Evaluate the repo against the registry.
 *
 * @param {string[]} files tracked paths, repo-relative with forward slashes
 * @param {{entries, historicalRoots, allowed}} registry
 * @param {(p: string) => string|null} readFile null when the file cannot be read
 * @returns {{forbidden: Array<{filePath, term, line}>, stale: string[], redundant: string[]}}
 */
export function evaluate(files, registry, readFile) {
  const { entries, historicalRoots, allowed } = registry;
  const forbidden = [];
  const mentioning = new Set();
  for (const filePath of files) {
    if (isUnderHistoricalRoot(filePath, historicalRoots) || !isScannable(filePath)) continue;
    const text = readFile(filePath);
    if (text === null) continue;
    const hits = findRetiredMentions(text, entries);
    if (hits.length === 0) continue;
    mentioning.add(filePath);
    if (Object.hasOwn(allowed, filePath)) continue;
    for (const hit of hits) forbidden.push({ filePath, ...hit });
  }
  const stale = Object.keys(allowed).filter(
    (p) => !mentioning.has(p) && !isUnderHistoricalRoot(p, historicalRoots),
  );
  const redundant = Object.keys(allowed).filter((p) => isUnderHistoricalRoot(p, historicalRoots));
  return { forbidden, stale, redundant };
}

function trackedFiles() {
  return gitText(["ls-files", "-z"], { trim: false, maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

function readTracked(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  let fd;
  try {
    // Open once, then fstat and read that descriptor. A path stat before the
    // read is a check-then-use race (CodeQL js/file-system-race): the name can
    // point at a different file between the two calls. A missing path throws
    // here and is still reported as unreadable.
    fd = fs.openSync(abs, "r");
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    const buf = Buffer.alloc(stat.size);
    const n = fs.readSync(fd, buf, 0, stat.size, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    // Tracked but absent in this checkout (sparse checkout, deleted in the
    // working tree), or not a readable file: nothing to read, so nothing to report.
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // The verdict is the bytes already read; a close error is not a missing file.
      }
    }
  }
}

function main() {
  const registry = loadRegistry(fs.readFileSync(REGISTRY, "utf-8"));
  const { forbidden, stale, redundant } = evaluate(trackedFiles(), registry, readTracked);
  const byTerm = new Map(registry.entries.map((e) => [e.term, e]));

  if (forbidden.length === 0 && stale.length === 0 && redundant.length === 0) {
    console.log(
      `[retired-substrate] OK — no tracked file names retired substrate outside the ${Object.keys(registry.allowed).length} allowlisted file(s) and ${Object.keys(registry.historicalRoots).length} historical root(s).`,
    );
    return;
  }

  console.error("");
  if (forbidden.length > 0) {
    console.error(`[retired-substrate] FAILED — ${forbidden.length} mention(s) of RETIRED substrate:`);
    console.error("");
    for (const f of forbidden) {
      const meta = byTerm.get(f.term) ?? {};
      console.error(`  • ${f.filePath}:${f.line}`);
      console.error(`      names "${f.term}", retired by ${meta.retiredBy ?? "an earlier change"}`);
      if (meta.replacement) console.error(`      use instead: ${meta.replacement}`);
    }
    console.error("");
    console.error("A tracked file names infrastructure the platform no longer runs. In a doc it");
    console.error("misinforms; in config, a prompt or a runbook it sends someone to a dead service.");
    console.error("Describe what runs today. Only if the mention is a guard, true history, or");
    console.error("third-party data, add the file to `allowed` in scripts/retired-substrate.json");
    console.error("with the reason.");
    console.error("");
  }
  if (stale.length > 0) {
    console.error(`[retired-substrate] FAILED — ${stale.length} stale allowlist entr${stale.length === 1 ? "y" : "ies"}:`);
    for (const p of stale) console.error(`  • ${p} no longer names a retired term (or no longer exists)`);
    console.error("Remove it from `allowed` in scripts/retired-substrate.json so the mention cannot regrow.");
    console.error("");
  }
  if (redundant.length > 0) {
    console.error(`[retired-substrate] FAILED — ${redundant.length} allowlist entr${redundant.length === 1 ? "y sits" : "ies sit"} under a historical root:`);
    for (const p of redundant) console.error(`  • ${p}`);
    console.error("");
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-retired-substrate.mjs")) {
  main();
}
