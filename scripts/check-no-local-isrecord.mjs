#!/usr/bin/env node
/**
 * BI-6A505BFF (EP-8DC217EB BET-6) — CI ratchet: no NEW local `isRecord` helper.
 *
 * The object-guard `isRecord(v): v is Record<string, unknown>` was hand-copied
 * verbatim into 20+ modules, each re-deriving the same
 * `typeof === "object" && !== null && !Array.isArray` predicate. It now has one
 * canonical home:
 *
 *   import { isRecord } from "@/lib/shared/coerce";
 *
 * This guard freezes the copy count. Every file that ALREADY defines a local
 * `isRecord` at the baseline is in ALLOWLIST (a migration backlog — remove the
 * entry when the file switches to the shared import). Any NEW local definition
 * outside the allowlist fails CI, so fresh code imports the shared helper
 * instead of spawning copy #21.
 *
 * Scope: apps/web/lib (source only, tests excluded). The canonical definition
 * in lib/shared/coerce.ts is the single sanctioned home and is skipped by path.
 *
 * NOTE — this is a DUPLICATION ratchet, not a correctness gate: the allowlisted
 * copies are behaviourally identical to the shared helper. Some allowlisted
 * files live under lib/tak/* and lib/routing/* (a collision boundary this
 * refactor could not touch); they migrate in a follow-on. Listing their PATHS
 * here does not modify them.
 *
 * Run: node scripts/check-no-local-isrecord.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// The one sanctioned home for isRecord — never flagged.
export const CANONICAL = "apps/web/lib/shared/coerce.ts";

// Files that ALREADY defined a local isRecord at the BI-6A505BFF baseline.
// This is a migration backlog: delete an entry when its file adopts
// `import { isRecord } from "@/lib/shared/coerce"`. Do NOT add new entries —
// new code must import the shared helper.
export const ALLOWLIST = new Set([
  "apps/web/lib/actions/work-pattern-review.ts",
  "apps/web/lib/brand/task-artifacts.ts",
  "apps/web/lib/build/business-build-brief.ts",
  "apps/web/lib/build/task-results.ts",
  "apps/web/lib/build/verification-output.ts",
  "apps/web/lib/build/sandbox/build-branch.ts",
  "apps/web/lib/marketing.ts",
  "apps/web/lib/release/branding.ts",
  "apps/web/lib/routing/chat-adapter.ts",
  "apps/web/lib/shared/org-address.ts",
  "apps/web/lib/tak/pattern-observer-service.ts",
  "apps/web/lib/tak/pattern-observer/observer.ts",
  "apps/web/lib/tak/question-packet.ts",
  "apps/web/lib/tak/task-stream-projection.ts",
  "apps/web/lib/tak/work-pattern-case-json.ts",
  "apps/web/lib/tak/work-pattern-profile-review.ts",
  "apps/web/lib/tak/work-pattern-read-model.ts",
  "apps/web/lib/tak/work-pattern-review.ts",
  "apps/web/lib/tak/work-pattern-shadow-evaluation.ts",
  "apps/web/lib/tak/work-pattern-types.ts",
]);

// A local isRecord DEFINITION (function decl or const arrow), not a call site
// or an import. `\bisRecord\s*\(` after `function` is the decl; `const isRecord =`
// is the arrow form.
export const DEFINITION_PATTERNS = [
  /\b(?:export\s+)?function\s+isRecord\s*\(/,
  /\b(?:export\s+)?const\s+isRecord\s*[:=]/,
];

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Return the 1-based line numbers + text of every local isRecord definition. */
export function findDefinitionLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    // Skip import lines — `import { isRecord }` is the sanctioned adoption.
    if (/^\s*import\b/.test(line)) continue;
    if (DEFINITION_PATTERNS.some((p) => p.test(line))) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "__snapshots__" || entry === "dist") continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx") || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

/** Scan apps/web/lib under `root`; return definitions outside the allowlist. */
export function scanRepo(root = process.cwd()) {
  const scanDir = join(root, "apps", "web", "lib");
  const violations = [];
  for (const file of walk(scanDir)) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel === CANONICAL || ALLOWLIST.has(rel)) continue;
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const h of findDefinitionLines(body)) {
      violations.push({ file: rel, ...h });
    }
  }
  return violations;
}

/** Allowlisted files that no longer define isRecord — stale entries to prune. */
export function findStaleAllowlist(root = process.cwd()) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel); // file gone
      continue;
    }
    if (findDefinitionLines(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: BI-6A505BFF — a NEW local `isRecord` helper was added.");
    console.error("");
    console.error("There is one canonical object-guard. Import it instead of copying:");
    console.error('  import { isRecord } from "@/lib/shared/coerce";');
    console.error("");
    console.error("Offending definitions:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: BI-6A505BFF — the isRecord allowlist is stale.");
    console.error("These files no longer define a local isRecord (migrated or removed);");
    console.error("delete them from ALLOWLIST in scripts/check-no-local-isrecord.mjs:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No new local isRecord helpers (${ALLOWLIST.size} pre-existing copies pending migration to @/lib/shared/coerce).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
