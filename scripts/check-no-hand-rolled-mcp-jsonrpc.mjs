#!/usr/bin/env node
/**
 * Plan 2026-09-08 §10.5 S8: CI ratchet on hand-rolled MCP JSON-RPC clients.
 *
 * Scripts used to build their own `{ jsonrpc: "2.0", id, method: "tools/call",
 * params }` body, attach the bearer token, pick a transport (fetch, node:http,
 * or a curl child process) and a timeout, and unwrap the reply. They now go
 * through one client:
 *
 *   import { mcpCall, mcpPost } from "./lib/mcp-client.mjs";
 *
 * `mcpCall` returns the unwrapped tool result and throws; `mcpPost` returns the
 * raw `{ status, text }` so a fail-open caller keeps its own policy. Both run
 * the loopback-endpoint check and the client_credentials bearer resolution.
 *
 * This guard flags any file in scope, outside scripts/lib/mcp-client.mjs, that
 * writes a JSON-RPC 2.0 envelope itself. ALLOWLIST is closed: every entry says
 * why that file cannot import the shared client. Do NOT add entries to dodge a
 * migration; a new one is argued in review.
 *
 * Scope: .mjs/.js/.cjs under scripts/, packages/<pkg>/scripts/,
 * packages/<pkg>/hooks/ and .claude/, tests excluded (they build fixture
 * replies). The MCP server itself (apps/web) is out of scope.
 *
 * Run: node scripts/check-no-hand-rolled-mcp-jsonrpc.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The one sanctioned home for the JSON-RPC envelope: never flagged.
export const CANONICAL = "scripts/lib/mcp-client.mjs";
const SELF = "scripts/check-no-hand-rolled-mcp-jsonrpc.mjs";

// Closed. Each entry carries the reason it cannot use the shared client.
export const ALLOWLIST = new Map([
  [
    "scripts/mcp-progressive-disclosure-conformance.mjs",
    "Protocol conformance probe: it asserts the server's behaviour at the wire (User-Agent tiering, "
      + "MCP-Protocol-Version, Accept negotiation, SSE framing, JSON-RPC ids across batches). "
      + "A client that hides those details would hide what it tests.",
  ],
  [
    "packages/dpf-skill-pack/hooks/plan-backlog-coverage-guard.mjs",
    "Ships inside the dpf-platform plugin and runs from the plugin cache, outside any checkout, "
      + "so it cannot import scripts/lib/.",
  ],
]);

export const ENVELOPE_PATTERN = /["']?jsonrpc["']?\s*:\s*["']2\.0["']/;

const EXTENSIONS = [".mjs", ".js", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", "fixtures", "__fixtures__", "__tests__", "dist"]);

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

function isTestFile(path) {
  return /\.(?:test|spec)\.[cm]?js$/.test(path);
}

/** 1-based line numbers + text of every JSON-RPC 2.0 envelope in `body`. */
export function findEnvelopeLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (ENVELOPE_PATTERN.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() });
  }
  return hits;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && EXTENSIONS.some((ext) => full.endsWith(ext)) && !isTestFile(full)) yield full;
  }
}

/** Directories the ratchet covers, relative to `root`. */
export function scopeDirs(root = REPO_ROOT) {
  const dirs = [join(root, "scripts"), join(root, ".claude")];
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      dirs.push(join(packagesDir, pkg, "scripts"), join(packagesDir, pkg, "hooks"));
    }
  }
  return dirs;
}

/** Hand-rolled envelopes outside the canonical client and the allowlist. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const dir of scopeDirs(root)) {
    for (const file of walk(dir)) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (rel === CANONICAL || rel === SELF || ALLOWLIST.has(rel)) continue;
      for (const h of findEnvelopeLines(readFileSync(file, "utf8"))) violations.push({ file: rel, ...h });
    }
  }
  return violations;
}

/** Allowlisted files that no longer build an envelope: stale entries to prune. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const stale = [];
  for (const rel of ALLOWLIST.keys()) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel);
      continue;
    }
    if (findEnvelopeLines(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();
  if (violations.length > 0) {
    console.error("\nERROR: a script builds its own MCP JSON-RPC request.\n");
    console.error("Use the shared client (loopback check, credential resolution, one transport):");
    console.error('  import { mcpCall, mcpPost } from "./lib/mcp-client.mjs";\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error(`\nERROR: stale ALLOWLIST entries in ${SELF} (delete them):`);
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ No hand-rolled MCP JSON-RPC clients (${ALLOWLIST.size} documented exceptions; home: ${CANONICAL}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
