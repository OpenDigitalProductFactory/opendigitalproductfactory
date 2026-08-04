#!/usr/bin/env node
// scripts/check-missing-ci-dispatch.mjs
//
// Missing-CI-dispatch watch. Every other CI failure mode in this repo turns a
// check RED. This one makes checks ABSENT, which is indistinguishable from
// "still pending" — so nothing alerts, auto-merge waits forever, and the PR
// simply never moves.
//
// Observed 2026-08-01: the installation's GitHub API rate limit was exhausted
// (the same exhaustion that reported "CodeQL job status was configuration
// error" on three Analyze jobs). PR #3907 was opened inside that window and
// received FIVE checks instead of the usual ~36 — the CI workflow never
// dispatched at all. Auto-merge was armed and would have waited indefinitely on
// required contexts that were never coming. It was found by a human eyeballing
// the check count, which is not a control.
//
// Detection is deliberately shape-based, not cause-based: an open, non-draft PR
// whose head commit is older than the threshold and has ZERO check runs of any
// kind. Rate limiting is only the cause we have seen; a bad `paths` filter, a
// disabled workflow, or a webhook drop present identically and are equally worth
// catching.
//
// Pure `findMissingDispatch()` (unit-tested) + a thin gh CLI wrapper, matching
// scripts/check-merge-queue-churn.mjs. Run on a schedule by
// .github/workflows/watch-missing-ci-dispatch.yml. `--dry-run` prints the
// analysis without commenting.

import { execFileSync } from "node:child_process";

const COMMENT_MARKER = "<!-- missing-ci-dispatch-watch -->";

/** Default grace period. Dispatch normally happens in seconds; 20 minutes is
 *  generous enough that a merely slow queue is never flagged. */
const DEFAULT_MIN_AGE_MINUTES = 20;

/**
 * Timestamp of the PR's head commit, in ms. Uses the newest `committedDate`
 * across the PR's commits rather than the PR's own `updatedAt`, because
 * `updatedAt` also moves on comments and label changes — a PR that was pushed
 * three days ago but commented on a minute ago must not read as "just pushed"
 * and escape the age check.
 *
 * @param {{commits?: Array<{committedDate?: string}>}} pr
 * @returns {number|null} ms since epoch, or null when unknowable
 */
export function headCommitTime(pr) {
  const commits = Array.isArray(pr?.commits) ? pr.commits : [];
  let newest = null;
  for (const c of commits) {
    const t = Date.parse(c?.committedDate ?? "");
    if (Number.isNaN(t)) continue;
    if (newest === null || t > newest) newest = t;
  }
  return newest;
}

/**
 * Flag open PRs whose head has received NO check runs at all.
 *
 * Skips, and why each skip is deliberate:
 *   - drafts            — not expected to be gated yet
 *   - any checks present — dispatch worked; a RED check is a different problem
 *                          with its own alerting, not this one
 *   - head younger than minAgeMinutes — dispatch may legitimately be in flight
 *   - unknowable head time — we do not guess; a missing timestamp is not
 *                          evidence of a missing run
 *
 * Pure.
 *
 * @param {Array<{number?:number, isDraft?:boolean, headRefOid?:string,
 *                statusCheckRollup?:Array<unknown>, commits?:Array<{committedDate?:string}>}>} prs
 * @param {{minAgeMinutes?:number, now?:number}} [opts]
 * @returns {Array<{pr:number, headSha:string, ageMinutes:number}>}
 */
export function findMissingDispatch(prs, opts = {}) {
  const minAgeMinutes = opts.minAgeMinutes ?? DEFAULT_MIN_AGE_MINUTES;
  const now = opts.now ?? Date.now();
  const flagged = [];

  for (const pr of Array.isArray(prs) ? prs : []) {
    if (!pr || typeof pr.number !== "number") continue;
    if (pr.isDraft) continue;
    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    if (checks.length > 0) continue;

    const headAt = headCommitTime(pr);
    if (headAt === null) continue;

    const ageMinutes = (now - headAt) / 60000;
    if (ageMinutes < minAgeMinutes) continue;

    flagged.push({
      pr: pr.number,
      headSha: String(pr.headRefOid ?? "").slice(0, 8),
      ageMinutes: Math.round(ageMinutes),
    });
  }
  return flagged;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

export function commentBody(f) {
  return (
    `${COMMENT_MARKER}\n` +
    `⚠️ **No CI was dispatched for this PR.** Head \`${f.headSha}\` has been pushed for ` +
    `**${f.ageMinutes} minutes** with **zero check runs** — not red, simply absent.\n\n` +
    `This is not the same as CI being slow. Nothing is queued, so nothing will arrive: if ` +
    `auto-merge is enabled it will wait forever on required contexts that were never created.\n\n` +
    `The cause we have seen is the installation's GitHub API rate limit silently dropping ` +
    `workflow dispatch (2026-08-01, PR #3907 got 5 checks instead of ~36). A disabled workflow, ` +
    `an over-broad \`paths\` filter, or a dropped webhook look identical from here.\n\n` +
    `**To recover:** re-trigger the \`pull_request\` event — push a commit, or close and reopen ` +
    `the PR. "Re-run jobs" will not help, because there are no jobs to re-run.`
  );
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  let prs;
  try {
    // One call for everything: statusCheckRollup tells us whether ANY check
    // exists on the head, so we never need a per-PR follow-up. That matters
    // here more than usual — this watch exists because API budget ran out, and
    // a detector that is itself expensive would be part of the problem.
    prs = JSON.parse(
      gh([
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,isDraft,headRefOid,statusCheckRollup,commits",
      ]),
    );
  } catch (err) {
    console.error("[missing-ci-dispatch] could not list open PRs:", err.message);
    process.exit(0); // never fail the scheduled job on a transient gh/API error
  }

  const flagged = findMissingDispatch(prs);
  if (flagged.length === 0) {
    console.log(`[missing-ci-dispatch] all ${prs.length} open PR(s) have dispatched CI.`);
    return;
  }

  if (dryRun) {
    for (const f of flagged) {
      console.log(`[missing-ci-dispatch] (dry-run) PR #${f.pr}: head ${f.headSha}, ${f.ageMinutes}m, 0 checks`);
    }
    return;
  }

  for (const f of flagged) {
    let view;
    try {
      view = JSON.parse(gh(["pr", "view", String(f.pr), "--json", "state,comments"]));
    } catch {
      console.log(`[missing-ci-dispatch] PR #${f.pr}: could not read — skip`);
      continue;
    }
    if (view.state !== "OPEN") {
      console.log(`[missing-ci-dispatch] PR #${f.pr} is ${view.state} — skip`);
      continue;
    }
    if ((view.comments ?? []).some((c) => (c.body ?? "").includes(COMMENT_MARKER))) {
      console.log(`[missing-ci-dispatch] PR #${f.pr} already flagged — skip`);
      continue;
    }
    gh(["pr", "comment", String(f.pr), "--body", commentBody(f)]);
    console.log(`[missing-ci-dispatch] flagged PR #${f.pr} (head ${f.headSha}, ${f.ageMinutes}m, 0 checks).`);
  }
}

const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("check-missing-ci-dispatch.mjs");
if (invokedDirectly) main();
