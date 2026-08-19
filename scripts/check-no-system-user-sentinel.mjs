#!/usr/bin/env node
/**
 * BI-170E99A9 — CI guard: no "system" sentinel as a User principal id.
 *
 * There is no `User` row with id "system". Any value that becomes a User-FK
 * column — notably `TaskRun.userId`, a NOT NULL FK to `User`
 * (`TaskRun_userId_fkey`) — fails the FK with Prisma P2003 at runtime when set
 * to the sentinel. This bug class has shipped twice:
 *   - PR #1925 (skill curator):  hardcoded userId:"system"
 *   - PR #1926 (auto-ship):      createdById ?? "system"
 * Both only surface on the rare null-owner edge, so neither was caught by tests
 * exercising the happy path. This static guard catches the THIRD before merge.
 *
 * Scans apps/web/lib (where User-FK writes originate, same scope as the
 * stall-detection guard) for the two forms the bug takes:
 *   - `userId: "system"` / `userId = "system"`  (the FK field set to the sentinel)
 *   - `?? "system"`                              (a nullish-fallback to the sentinel)
 * Comment lines are skipped (so the scheduled-owner.ts header that DOCUMENTS the
 * anti-pattern doesn't trip the guard). Matches are intersected with an
 * allowlist of files with a documented NON-referential use. Any hit outside the
 * allowlist fails CI with a message pointing at the sanctioned resolver.
 *
 * Note: `\buserId` (lowercase, word-boundary) deliberately does NOT match the
 * non-referential `savedByUserId` (a plain String column, no @relation), which
 * keeps the actor-path files (e.g. build-review-verification.ts) OUT of the
 * allowlist — so a re-introduced `?? "system"` there is still caught.
 *
 * Run: node scripts/check-no-system-user-sentinel.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// Files allowed to contain a `userId: "system"` / `?? "system"` form because
// the value is NOT written to a User-FK column. Each entry MUST carry a comment
// explaining why — future contributors deserve the context.
export const ALLOWLIST = new Set([
  // buildAutoDiscoveryEvalEvents() default param. The "ai/eval.run" event path
  // (eval-background.ts -> runDimensionEval) never persists userId to a User FK.
  "apps/web/lib/inference/ai-provider-internals.ts",
  // Two non-FK uses: (1) the in-memory getAvailableTools() admin context, never
  // persisted; (2) runAgenticLoop(), which writes only ToolExecution.userId — a
  // plain String column with no @relation to User.
  "apps/web/lib/build/build-pipeline.ts",
  // Writes ToolExecution.userId — a non-referential String column, not a User FK.
  "apps/web/lib/build/sandbox/agents/dpf-native-agent-runner.ts",
]);

export const PATTERNS = [
  /\buserId\s*[:=]\s*["']system["']/,
  /\?\?\s*["']system["']/,
];

// Skip comment lines so doc/JSDoc that mentions the anti-pattern (e.g. the
// scheduled-owner.ts header explaining why the sentinel is wrong) is not a hit.
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Return the 1-based line numbers + text of every (non-comment) sentinel hit. */
export function findViolationLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (PATTERNS.some((p) => p.test(line))) {
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
      // Source files only — skip tests and type-only declarations.
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx") || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

/** Scan apps/web/lib under `root` and return all violations outside the allowlist. */
export function scanRepo(root = process.cwd()) {
  const scanDir = join(root, "apps", "web", "lib");
  const violations = [];
  for (const file of walk(scanDir)) {
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(root, file).replace(/\\/g, "/");
    if (ALLOWLIST.has(rel)) continue;
    for (const h of findViolationLines(body)) {
      violations.push({ file: rel, ...h });
    }
  }
  return violations;
}

function main() {
  const violations = scanRepo();
  if (violations.length > 0) {
    console.error("");
    console.error('ERROR: BI-170E99A9 — a "system" sentinel is used as a User principal id.');
    console.error("");
    console.error('There is no User row with id "system". A value that becomes a User-FK');
    console.error("column (e.g. TaskRun.userId, a NOT NULL FK -> User) fails the FK with");
    console.error("Prisma P2003 at runtime. This bug shipped in #1925 (skill curator) and");
    console.error("#1926 (auto-ship); this guard stops the third.");
    console.error("");
    console.error("Offending lines:");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    console.error("Fix — resolve a REAL principal instead of the sentinel:");
    console.error('  import { resolveScheduledOwnerUserId } from "@/lib/queue/scheduled-owner";');
    console.error("  const actorUserId = createdById ?? (await resolveScheduledOwnerUserId());");
    console.error("It returns the install owner (oldest active superuser) and throws if none.");
    console.error("");
    console.error("If this is a genuinely NON-referential use (a String column with no");
    console.error("@relation to User, or an in-memory context), add the file to ALLOWLIST in");
    console.error("scripts/check-no-system-user-sentinel.mjs with a one-line reason.");
    console.error("");
    process.exit(1);
  }
  console.log(
    `✓ No "system" user-principal sentinels outside the allowlist (${ALLOWLIST.size} allowed files).`,
  );
}

// Run main() only when invoked directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
