#!/usr/bin/env node
// scripts/check-guard-diff-honesty.mjs — no diff-scoped guard may swallow a
// failed `git diff` into an empty change set (BI-FACB7C05, BI-B6433DC6).
//
// WHY THIS GUARD EXISTS. `git diff <base>...HEAD` exits 128 with EMPTY stdout
// when the base cannot be resolved. A guard whose git wrapper collapses a
// non-zero exit into `""` reads that as "no files changed" and prints its clean
// line — a pass from a guard that never saw the change. A contributor in a
// shallow clone or a stale worktree then pushes on confidence no gate earned.
//
// The class has been closed by hand four times (BI-20599979, BI-B6433DC6, the
// ten-guard sweep in PR #4886, and the two `--diff-filter=AM` holdouts that
// sweep missed while its commit message claimed every remaining diff-scoped
// guard had been converted). Hand-picking does not close a class. This guard
// does: `scripts/lib/git-changed-files.mjs` is the honest helper, and anything
// that reaches for a raw swallowing diff instead fails here.
//
// Zero violations at introduction, so there is no baseline to ratchet: the
// correct number is zero and stays zero.
//
// THE HONEST PATTERN:
//   import { exitUnresolvable, listChangedFiles } from "./lib/git-changed-files.mjs";
//   const listed = listChangedFiles(base, { diffArgs: ["--diff-filter=AM"] });
//   if (listed.status === "unresolvable") exitUnresolvable("my-guard", base, listed.detail);
//
// A file that calls exitUnresolvable / requireChangedFiles anywhere has proven
// the base before any later read, so follow-up raw diffs there are accepted.
// For anything this detector genuinely cannot judge, state the exemption:
//   // diff-honesty: allow <reason>

import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { findDiffSwallows } from "./lib/guard-diff-honesty-detect.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Scripts are the guard surface; nothing else spawns a gate-deciding diff. */
export const SCANNED_ROOTS = Object.freeze(["scripts"]);

/** Collect every `.mjs` under the scanned roots (repo-relative, forward slashes). */
export function collectGuardSources(repoRoot = REPO_ROOT, roots = SCANNED_ROOTS) {
  const found = [];
  const walk = (absDir) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
        walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".mjs")) {
        found.push(path.relative(repoRoot, abs).split("\\").join("/"));
      }
    }
  };
  for (const root of roots) walk(path.join(repoRoot, root));
  found.sort((a, b) => a.localeCompare(b));
  return found;
}

/**
 * Every file whose diff range is decided by a swallowed git failure.
 *
 * `readSource` is injected so the guard's own tests never touch the repository.
 */
export function findDishonestGuards({
  files = collectGuardSources(),
  readSource = (file) => {
    try {
      return readFileSync(path.join(REPO_ROOT, file), "utf8");
    } catch {
      return null;
    }
  },
} = {}) {
  const findings = [];
  for (const file of files) {
    const source = readSource(file);
    if (source == null) continue;
    for (const hit of findDiffSwallows(source)) {
      findings.push({ file, ...hit });
    }
  }
  return findings;
}

export function main() {
  const findings = findDishonestGuards();
  if (findings.length === 0) {
    console.log(
      `[guard-diff-honesty] OK — no diff-scoped guard swallows a failed git diff into an empty change set.`,
    );
    return 0;
  }
  console.error("[guard-diff-honesty] FAILED — a guard decides its verdict from a swallowed git failure.");
  console.error("");
  console.error("`git diff <base>...HEAD` exits 128 with EMPTY stdout when the base cannot be");
  console.error("resolved. These catch blocks turn that into \"\", which reads as \"no files");
  console.error("changed\" — so the guard reports clean without ever seeing the change:");
  console.error("");
  for (const finding of findings) {
    console.error(`  ✗ ${finding.file}:${finding.line}`);
    console.error(`      ${finding.snippet}`);
  }
  console.error("");
  console.error("Use the shared helper, which separates an unreadable range from an empty one:");
  console.error("");
  console.error('  import { exitUnresolvable, listChangedFiles } from "./lib/git-changed-files.mjs";');
  console.error('  const listed = listChangedFiles(base, { diffArgs: ["--diff-filter=AM"] });');
  console.error('  if (listed.status === "unresolvable") exitUnresolvable("my-guard", base, listed.detail);');
  console.error("");
  console.error("If this detector cannot judge the call, state the exemption rather than leaving");
  console.error("it silent:   // diff-honesty: allow <reason>");
  return 1;
}

if (isEntryModule(import.meta.url)) {
  process.exit(main());
}
