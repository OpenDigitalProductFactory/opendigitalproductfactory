#!/usr/bin/env node
/**
 * BI-991D4DC8 — Static guard: no local `requireAuth` / `requireUser` re-implementations
 * inside server actions (EP-8DC217EB, "Vertical Integration Inward", BET-2 mechanical
 * adoption leaf).
 *
 * Background: ~17 action files had each grown their own copy of the session-auth
 * preamble under a slightly different name (`requireAuth`, `requireAuthUser`,
 * `requireAuthUserId`, `requireAuthenticated`, `requireUserId`, `requireSessionUser`,
 * `getSessionUser`, `requireSession`). They drifted on two axes that matter:
 *
 *   - the null-check: `!user` (loose) vs `!user?.id` (strict), and
 *   - the error string: `Error("Unauthorized")` vs `Error("Not authenticated")`.
 *
 * That divergence means two callers of "the same" guard get different behaviour and
 * different error copy. The canonical primitives now live in one place:
 *
 *     import { requireUser, requireUserId } from "@/lib/actions/shared/guards";
 *
 * with ONE contract — the strict `!user?.id` check and `Error("Unauthorized")`.
 *
 * This guard fails the build the moment a new local copy reappears. It matches the
 * ZERO-ARG guard shape only, so the two intentionally-bespoke helpers that take an
 * argument keep working without an allow-list:
 *
 *   - deliberation.ts `requireUser(userId: string)`  — looks a user up in the DB.
 *   - workbooks.ts    `requireUser(capability)`      — throws a typed WorkbookError(401).
 *
 * Run: node scripts/check-no-local-auth-guard.mjs
 * Exit 0 = clean; exit 1 = violations (with a clear, actionable report).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, "apps", "web", "lib", "actions");

// A zero-arg local guard whose name is in the requireAuth / requireUser family,
// declared as either a `function` or a `const … = () =>` arrow. The empty parens
// `\(\s*\)` are load-bearing: the two legitimate keepers take an argument, so they
// are excluded without needing a file allow-list.
const GUARD_NAMES =
  "requireAuth|requireUser|requireUserId|requireAuthUser|requireAuthUserId|" +
  "requireAuthenticated|requireSessionUser|getSessionUser|requireSession";
const FN_GUARD = new RegExp(
  `\\b(?:async\\s+)?function\\s+(?:${GUARD_NAMES})\\s*\\(\\s*\\)`,
);
const ARROW_GUARD = new RegExp(
  `\\bconst\\s+(?:${GUARD_NAMES})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?\\(\\s*\\)\\s*(?::[^=]+)?=>`,
);

// The single sanctioned home for these primitives, plus this guard itself (which
// documents the banned names). Keep tiny.
const ALLOW = new Set([
  "apps/web/lib/actions/shared/guards.ts",
  "scripts/check-no-local-auth-guard.mjs",
]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (["node_modules", ".next", "__snapshots__", "dist", "coverage"].includes(entry)) continue;
      yield* walk(full);
    } else if (s.isFile()) {
      // Tests legitimately stub auth guards.
      if (/\.(test|spec)\.[cm]?tsx?$/.test(full) || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

const violations = [];

for (const file of walk(SCAN_DIR)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOW.has(rel)) continue;
  let body;
  try {
    body = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = body.split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
    if (FN_GUARD.test(line) || ARROW_GUARD.test(line)) {
      violations.push(`${rel}:${i + 1}  ${trimmed.slice(0, 100)}`);
    }
  });
}

if (violations.length > 0) {
  console.error("");
  console.error("ERROR: BI-991D4DC8 — local `requireAuth` / `requireUser` guard found in a server action.");
  console.error("");
  console.error("These local copies of the session-auth preamble drift on the null-check");
  console.error("(`!user` vs `!user?.id`) and the error string (`Unauthorized` vs");
  console.error("`Not authenticated`). Use the single canonical contract instead:");
  console.error("");
  console.error('    import { requireUser, requireUserId } from "@/lib/actions/shared/guards";');
  console.error("");
  console.error("    const userId = await requireUserId();   // id only");
  console.error("    const user = await requireUser();       // full session user");
  console.error("");
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Both throw Error(\"Unauthorized\") on the strict `!user?.id` check. A guard that");
  console.error("genuinely does more (DB lookup, capability, a typed error) takes an argument and");
  console.error("is not matched — see deliberation.ts / workbooks.ts.");
  console.error("");
  process.exit(1);
}

console.log("✓ No local requireAuth/requireUser guards: server actions use shared/guards.ts (one Unauthorized contract).");
