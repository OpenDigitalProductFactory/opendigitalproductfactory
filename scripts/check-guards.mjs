#!/usr/bin/env node
// Repo guard loop — BI-3B0AD9CF (EP-8DC217EB).
//
// One runner discovers and executes every `scripts/check-no-*.mjs` ratchet
// guard, running each guard's sibling `*.test.mjs` self-test first. CI calls
// this once (the "Repo Guard Loop" job) and `pnpm check:guards` is the local
// equivalent.
//
// Why a loop instead of one CI job per guard: every consolidation PR used to
// add a job to ci.yml AND a script entry to package.json AND its guard script,
// so concurrent consolidation PRs all conflicted on ci.yml/package.json, and
// every merge re-conflicted the remaining PRs. With the loop, adding a ratchet
// is ONE new `scripts/check-no-<thing>.mjs` file — no ci.yml or package.json
// edit, no merge cascade.
//
// Contract for guard scripts:
//   - named scripts/check-no-<slug>.mjs
//   - exit 0 = clean, non-zero = violation (print the violation on stderr)
//   - optional sibling scripts/check-no-<slug>.test.mjs (node --test) proves
//     the guard logic itself; the loop runs it before the guard
//
//   node scripts/check-guards.mjs        # run all guards (CI)
//   pnpm check:guards                    # same, from anywhere in the repo

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..");

export function discoverGuardFiles(entries) {
  const sorted=[...entries].sort();
  return {
    guards: sorted.filter((f) => /^check-no-.*\.mjs$/.test(f) && !f.endsWith(".test.mjs")),
    tests: new Set(sorted.filter((f) => /^check-no-.*\.test\.mjs$/.test(f))),
  };
}

export function main() {
const { guards, tests } = discoverGuardFiles(readdirSync(SCRIPTS_DIR));

if (guards.length === 0) {
  console.error("No scripts/check-no-*.mjs guards found — that is itself a failure.");
  process.exit(1);
}

const failed = [];

for (const guard of guards) {
  const testFile = guard.replace(/\.mjs$/, ".test.mjs");
  if (tests.has(testFile)) {
    const t = spawnSync(process.execPath, ["--test", join(SCRIPTS_DIR, testFile)], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    if (t.status !== 0) {
      failed.push(`${testFile} (guard self-test)`);
      continue; // don't run a guard whose own logic is broken
    }
  }
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, guard)], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (r.status !== 0) failed.push(guard);
}

console.log("");
if (failed.length > 0) {
  console.error(`Guard loop: ${failed.length}/${guards.length} guard(s) FAILED:`);
  for (const f of failed) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Guard loop OK — ${guards.length} guards passed (${tests.size} self-tests).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
