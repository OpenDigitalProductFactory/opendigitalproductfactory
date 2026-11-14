#!/usr/bin/env node
// scripts/check-staged-scope.mjs — BI-66236024
//
//   node scripts/check-staged-scope.mjs            # advisory (default)
//   DPF_STAGED_SCOPE_ENFORCE=1 …                   # refuse the commit
//
// Compares what a commit STAGES against the paths the Workroom CLAIMED for
// edit. Reads only the local claim marker — no network call on the commit path,
// matching every other guard in this chain.
//
// ROLLOUT. Advisory by default, enforcing under DPF_STAGED_SCOPE_ENFORCE=1.
// This is the pattern workroom-claim-guard.mjs established and documented, and
// the reason is the same: a Workroom bound at birth (BI-0B292D84 layer 1) has a
// claim but no SCOPE yet, so enforcing by default would refuse commits for a
// condition the agent has not been asked to satisfy. Flip the default in the
// change that makes scope claims routine.
//
// It never fails closed on its own uncertainty: an unreadable marker, a missing
// one, or a claim with no scope all report INACTIVE and allow the commit — but
// they SAY SO. A guard that is off must never look like a guard that passed.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyStagedScope } from "./lib/staged-scope.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { CLAIM_MARKER_NAME } from "./lib/workroom-bind.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function readStagedPaths() {
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMRT"]);
  return out ? out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

export function readMarkerScopePaths() {
  try {
    const gitDir = git(["rev-parse", "--absolute-git-dir"]);
    const raw = readFileSync(join(gitDir, CLAIM_MARKER_NAME), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.scopePaths) ? parsed.scopePaths : null;
  } catch {
    return null; // no marker, or unreadable — "nothing to enforce against"
  }
}

/** Pure reporting core, so the message is testable without a repo. */
export function formatReport(result, { enforcing }) {
  if (!result.active) {
    return {
      exitCode: 0,
      lines: [`[staged-scope] INACTIVE — ${result.reason}. ${result.checked} staged path(s) unchecked.`],
    };
  }
  if (result.violations.length === 0) {
    return { exitCode: 0, lines: [`[staged-scope] ok — all ${result.checked} staged path(s) are within the Workroom's claim.`] };
  }
  const lines = [
    `[staged-scope] ${result.violations.length} staged path(s) fall OUTSIDE this Workroom's edit claim:`,
    ...result.violations.map((v) => `  - ${v}`),
    "Either claim the path (claim_workroom_scope) or unstage it. A blanket `git add -A`",
    "after a tooling run is how another session's work reaches your commit (BI-66236024).",
  ];
  if (!enforcing) {
    lines.push("Advisory only — set DPF_STAGED_SCOPE_ENFORCE=1 to make this refuse the commit.");
    return { exitCode: 0, lines };
  }
  lines.push("Bypass once, recorded rather than silent: DPF_SKIP_STAGED_SCOPE=1 git commit ...");
  return { exitCode: 1, lines };
}

export function main() {
  if (process.env.DPF_SKIP_STAGED_SCOPE === "1") {
    process.stdout.write("[staged-scope] SKIPPED by DPF_SKIP_STAGED_SCOPE=1 — not a pass.\n");
    return 0;
  }
  const result = classifyStagedScope({
    stagedPaths: readStagedPaths(),
    scopePaths: readMarkerScopePaths(),
  });
  const { exitCode, lines } = formatReport(result, { enforcing: process.env.DPF_STAGED_SCOPE_ENFORCE === "1" });
  process.stdout.write(`${lines.join("\n")}\n`);
  return exitCode;
}

if (isEntryModule(import.meta.url)) process.exitCode = main();
