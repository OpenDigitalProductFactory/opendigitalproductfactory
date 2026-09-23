#!/usr/bin/env node
// scripts/check-queue-flag-reachability.mjs — a flag the code reads but the
// deployment cannot supply is a feature that does not exist (BI-8914E888).
//
// THE CLASS THIS CATCHES
//
// A queue function declares `DPF_SOMETHING_ENABLED`, reads it, and branches on
// it. Nothing passes it through `docker-compose.yml`, so on every install it is
// undefined forever. The function runs, takes the disabled branch, logs nothing
// unusual, and looks exactly like a feature nobody turned on. From the
// operator's side that is indistinguishable from a feature that was never
// built — except that `.env` does not work either, and the only way to set it
// is to edit installed compose, which AGENTS.md forbids.
//
// Measured on 2026-09-23: 4 of 12 flags read by queue functions were
// unreachable, including `DPF_WORKTREE_JANITOR_AUTO_REAP` — the switch that
// decides whether the worktree janitor may act. It had been in observe-only
// mode with no way out of it while the install accumulated 157 worktrees, 83 of
// them merged and reapable.
//
// This is the same family as BI-B3370CB2, where the janitor's SCRIPT was never
// copied into the image, and as `check-dockerfile-copied-script-imports.mjs`,
// which catches the import half of that. Three instances of one shape, all
// found by hand, weeks apart. The shape is: THE CAPABILITY WAS BUILT AND THE
// LAST WIRE WAS NEVER RUN.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not require a flag to be ENABLED, or to have any particular default.
// Opting out is a real choice. It requires only that the deployment be ABLE to
// supply it, so the choice exists at all.
//
// Usage:
//   node scripts/check-queue-flag-reachability.mjs
//   node scripts/check-queue-flag-reachability.mjs --json

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { isEntryModule } from "./lib/entry-module.mjs";

/** Where queue functions live, relative to the repo root. */
export const QUEUE_FUNCTION_DIR = "apps/web/lib/queue/functions";

/** Compose files an install actually runs. */
export const COMPOSE_FILES = ["docker-compose.yml"];

/**
 * Flags allowed to be unreachable, each with the reason it is legitimately not
 * install-settable. An entry here is a decision with a name on it, not a
 * silence. Keep it short: the point of the guard is that this list stays small.
 */
export const REACHABILITY_EXEMPT = Object.freeze({
  // Set by the runtime itself rather than an operator, or read from a non-
  // compose source. Add an entry ONLY with a reason a reader can check.
});

const FLAG_RE = /"(DPF_[A-Z0-9_]+)"/g;

/**
 * Every DPF_* flag a queue function mentions as a string literal, with the
 * files that mention it.
 *
 * A string literal is the right signal precisely because it is how these are
 * declared — `export const X_FLAG = "DPF_X"` — and it costs nothing to be
 * generous: a false positive is a flag someone named and did not wire, which is
 * worth a look either way.
 */
export function collectQueueFlags(dir, { readdir = readdirSync, readFile = readFileSync } = {}) {
  const flags = new Map();
  let entries;
  try {
    entries = readdir(dir);
  } catch {
    return flags;
  }
  for (const name of entries) {
    if (!name.endsWith(".ts") || name.includes(".test.")) continue;
    let source;
    try {
      source = String(readFile(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    for (const match of source.matchAll(FLAG_RE)) {
      const flag = match[1];
      if (!flags.has(flag)) flags.set(flag, new Set());
      flags.get(flag).add(name);
    }
  }
  return flags;
}

/**
 * Which of those flags no compose file forwards.
 *
 * `composeText` is the concatenation of every compose file, so a flag wired in
 * any of them counts as reachable.
 */
export function findUnreachableFlags(flags, composeText, exempt = REACHABILITY_EXEMPT) {
  const unreachable = [];
  for (const [flag, files] of [...flags].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (Object.hasOwn(exempt, flag)) continue;
    if (composeText.includes(flag)) continue;
    unreachable.push({ flag, files: [...files].sort() });
  }
  return unreachable;
}

/** The operator-facing report for one unreachable flag. */
export function describeUnreachableFlag({ flag, files }) {
  return [
    `  ${flag}`,
    `      read by: ${files.join(", ")}`,
    `      add to docker-compose.yml:  ${flag}: \${${flag}:-0}`,
  ].join("\n");
}

function main() {
  const repoRoot = process.cwd();
  const dir = path.join(repoRoot, QUEUE_FUNCTION_DIR);
  if (!existsSync(dir)) {
    console.error(`[queue-flag-reachability] CANNOT RUN — ${QUEUE_FUNCTION_DIR} not found.`);
    console.error("Run this guard from the repository root; an empty scan cannot tell");
    console.error("'nothing to check' from 'nothing wrong'.");
    process.exitCode = 2;
    return;
  }

  const composeText = COMPOSE_FILES.map((f) => {
    try {
      return readFileSync(path.join(repoRoot, f), "utf8");
    } catch {
      return "";
    }
  }).join("\n");

  if (composeText.trim().length === 0) {
    console.error("[queue-flag-reachability] CANNOT RUN — no compose file was readable.");
    process.exitCode = 2;
    return;
  }

  const flags = collectQueueFlags(dir);
  if (flags.size === 0) {
    console.error("[queue-flag-reachability] CANNOT RUN — no queue function declared any DPF_* flag.");
    process.exitCode = 2;
    return;
  }

  const unreachable = findUnreachableFlags(flags, composeText);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ scanned: flags.size, unreachable }, null, 2));
    process.exitCode = unreachable.length > 0 ? 1 : 0;
    return;
  }

  if (unreachable.length === 0) {
    console.log(
      `[queue-flag-reachability] OK — every one of ${flags.size} queue-function flag(s) can be set on an install.`,
    );
    return;
  }

  console.error("[queue-flag-reachability] FAILED — a flag the code reads that no install can supply.\n");
  for (const row of unreachable) console.error(describeUnreachableFlag(row));
  console.error("");
  console.error("A flag with no compose passthrough is undefined on every install, forever. The");
  console.error("function takes its disabled branch and looks exactly like a feature nobody");
  console.error("turned on. Setting it in the install's .env does nothing, and editing installed");
  console.error("compose is forbidden (AGENTS.md), so the operator has no way to opt in at all.");
  console.error("");
  console.error("Default it OFF if that is the safe default — this guard asks only that the");
  console.error("choice be REACHABLE, never that it be enabled.");
  process.exitCode = 1;
}

if (isEntryModule(import.meta.url)) main();
