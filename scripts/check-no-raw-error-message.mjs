#!/usr/bin/env node
/**
 * EP-8DC217EB / BET-6 (BI-B4EF08FA) — Static guard: no raw
 * `x instanceof Error ? x.message : String(x)` ternary.
 *
 * This idiom was hand-written at ~180 sites across ~114 files. It is now the
 * canonical helper `getErrorMessage(err)` in `apps/web/lib/shared/get-error-message.ts`,
 * which additionally handles string throws and `{message}`-bearing objects. A
 * raw ternary reintroduces the drift (each site free to diverge) one edit at a
 * time — exactly how the duplication grew in the first place. This guard fails
 * the moment a new one appears.
 *
 *     import { getErrorMessage } from "@/lib/shared/get-error-message";
 *     const msg = getErrorMessage(err);
 *
 * Run: node scripts/check-no-raw-error-message.mjs
 * Exit 0 = clean; exit 1 = violations (with an actionable report).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  join(ROOT, "apps", "web", "app"),
  join(ROOT, "apps", "web", "components"),
  join(ROOT, "apps", "web", "lib"),
  join(ROOT, "apps", "web", "hooks"),
];

// `VAR instanceof Error ? VAR.message : String(VAR)` — the exact backreferenced
// idiom the helper replaces. Precise: the same identifier in all three slots.
const RAW = /\b([A-Za-z_$][\w$]*)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*String\(\s*\1\s*\)/;

// The helper itself documents/implements the sanctioned extraction; this guard
// documents the banned pattern.
const ALLOW = new Set([
  "apps/web/lib/shared/get-error-message.ts",
  // the test deliberately contains the legacy ternary to prove equivalence
  "apps/web/lib/shared/get-error-message.test.ts",
  "scripts/check-no-raw-error-message.mjs",
]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      yield* walk(p);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield p;
    }
  }
}

const violations = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const rel = relative(ROOT, file).split("\\").join("/");
    if (ALLOW.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (RAW.test(line)) violations.push(`${rel}:${i + 1}`);
    });
  }
}

if (violations.length > 0) {
  console.error(
    `\n✗ Raw error-message ternary found at ${violations.length} site(s).\n` +
      `  Use getErrorMessage(err) from "@/lib/shared/get-error-message" instead:\n`
  );
  for (const v of violations) console.error(`    ${v}`);
  console.error(
    `\n  Rationale: one canonical extraction; prevents the 180-site duplication from regrowing.\n`
  );
  process.exit(1);
}

console.log("✓ No raw error-message ternary — getErrorMessage is the single extraction.");
