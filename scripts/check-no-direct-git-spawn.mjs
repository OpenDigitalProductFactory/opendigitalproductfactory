#!/usr/bin/env node
/**
 * Plan 2026-09-08 §10.5 S1: CI ratchet on git process spawns in scripts/.
 *
 * Scripts used to carry more than thirty local `git()` / `runGit()` wrappers
 * with three argument orders and five failure behaviours. They now go through
 * one runner:
 *
 *   import { gitText, gitTextOrNull, runGit } from "./lib/git.mjs";
 *
 * This guard flags any script outside scripts/lib/git.mjs that starts a git
 * process itself (execFileSync / spawnSync / execSync / execFile / spawn with
 * "git"). ALLOWLIST is the closed migration backlog measured when the guard
 * landed: delete an entry when its file moves to the shared runner. Do NOT add
 * entries. A script that genuinely cannot import (for example one that must
 * stay free of static imports) is migrated or documented here in review.
 *
 * Scope: scripts/**\/*.mjs, tests excluded.
 *
 * Run: node scripts/check-no-direct-git-spawn.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The one sanctioned home for spawning git: never flagged.
export const CANONICAL = "scripts/lib/git.mjs";

// Closed migration backlog. Remove entries as files migrate; never add.
export const ALLOWLIST = new Set([
  "scripts/check-context-economy.mjs",
  "scripts/check-golden-decisions.mjs",
  "scripts/check-no-ambient-host-tests.mjs",
  "scripts/check-no-private-identity.mjs",
  "scripts/check-no-unattributable-deferral.mjs",
  "scripts/check-published-image-freshness.mjs",
  "scripts/check-single-worktree-base.mjs",
  "scripts/check-tool-surface.mjs",
  "scripts/governed-teardown.mjs",
  "scripts/host-resource-runner.mjs",
  "scripts/lib/dco-signoff.mjs",
  "scripts/lib/git-fetch-shared-safe.mjs",
  "scripts/lib/git-shallow-preflight.mjs",
  "scripts/lib/junction-safe-worktree-remove.mjs",
  "scripts/lib/semantic-review-gate.mjs",
  "scripts/lib/worktree-base.mjs",
  "scripts/local-ci-bounded-build.mjs",
  "scripts/local-ci-host-stage-calibration.mjs",
  "scripts/local-ci-runner.mjs",
  "scripts/local-ci-typecheck-runner.mjs",
  "scripts/local-ci-vitest-runner.mjs",
  "scripts/measure-platform-substrate.mjs",
  "scripts/merge-readiness-policy.mjs",
  "scripts/pregate-status.mjs",
  "scripts/pregate.mjs",
  "scripts/regen-lockfile.mjs",
  "scripts/release/verify-compose-image-manifests.mjs",
  "scripts/root-clone-refresh.mjs",
  "scripts/sbom/check-lockfile-release-age.mjs",
  "scripts/set-hooks-path.mjs",
  "scripts/test-n-minus-one-upgrade.mjs",
]);

export const SPAWN_PATTERN = /\b(?:execFileSync|spawnSync|execSync|execFile|spawn|exec)\(\s*["'`]git[\s"'`]/;

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** 1-based line numbers + text of every direct git spawn in `body`. */
export function findSpawnLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (SPAWN_PATTERN.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() });
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "fixtures" || entry === "__fixtures__") continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && full.endsWith(".mjs") && !full.endsWith(".test.mjs")) yield full;
  }
}

/** Direct git spawns outside the canonical runner and the allowlist. */
export function scanRepo(root = REPO_ROOT) {
  const violations = [];
  for (const file of walk(join(root, "scripts"))) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel === CANONICAL || rel === "scripts/check-no-direct-git-spawn.mjs" || ALLOWLIST.has(rel)) continue;
    for (const h of findSpawnLines(readFileSync(file, "utf8"))) violations.push({ file: rel, ...h });
  }
  return violations;
}

/** Allowlisted files that no longer spawn git: stale entries to prune. */
export function findStaleAllowlist(root = REPO_ROOT) {
  const stale = [];
  for (const rel of ALLOWLIST) {
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(rel);
      continue;
    }
    if (findSpawnLines(body).length === 0) stale.push(rel);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();
  if (violations.length > 0) {
    console.error("\nERROR: a script starts git itself.\n");
    console.error("Use the shared runner and pick the failure behaviour by name:");
    console.error('  import { gitText, gitTextOrNull, runGit } from "./lib/git.mjs";\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error("\nERROR: stale ALLOWLIST entries in scripts/check-no-direct-git-spawn.mjs (delete them):");
    for (const f of stale) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ No new direct git spawns (${ALLOWLIST.size} files pending migration to ${CANONICAL}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
