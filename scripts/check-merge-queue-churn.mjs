#!/usr/bin/env node
// scripts/check-merge-queue-churn.mjs
//
// Merge-queue churn watch. When a PR fails its merge_group CI it is silently
// removed from the merge queue; if auto-merge is re-enabled on the same commit
// it just churns again. PR #2157 did this for HOURS before a human noticed —
// the shift-left decision-baseline guard (PR #2194) catches the regression
// class, but NOT drift that breaks a PR while it sits in the queue. This watch
// closes that gap: it counts distinct failed queue attempts per PR in a recent
// window and, at a threshold, posts ONE comment so the churn is visible and the
// author knows to push a FIX rather than re-queue the same commit.
//
// Pure `analyzeChurn()` (unit-tested) + a thin gh CLI wrapper. Run on a schedule
// by .github/workflows/merge-queue-churn-watch.yml. `--dry-run` prints the
// analysis without commenting.

import { execFileSync } from "node:child_process";

const COMMENT_MARKER = "<!-- merge-queue-churn-watch -->";

/**
 * Group merge_group CI runs by PR and flag those with >= thresholdAttempts
 * DISTINCT failed queue attempts (distinct head SHAs) inside the window. A
 * queue attempt is one `gh-readonly-queue/<base>/pr-<n>-<sha>` ref; it counts
 * as failed if ANY of its runs failed (CI or DCO both kick the PR). Pure.
 *
 * @param {Array<{headBranch?:string, conclusion?:string, createdAt?:string}>} runs
 * @param {{thresholdAttempts?:number, windowHours?:number, now?:number}} [opts]
 * @returns {Array<{pr:number, failedAttempts:number, latestSha:string, latestAt:string}>}
 */
export function analyzeChurn(runs, { thresholdAttempts = 2, windowHours = 24, now = Date.now() } = {}) {
  const cutoff = now - windowHours * 3600 * 1000;
  const byPr = new Map(); // pr -> Map(sha -> latest ISO time of a failed run)
  for (const r of runs ?? []) {
    if (r?.conclusion !== "failure") continue;
    const t = Date.parse(r.createdAt ?? "");
    if (Number.isNaN(t) || t < cutoff) continue;
    const m = /\/pr-(\d+)-([0-9a-f]+)/.exec(r.headBranch ?? "");
    if (!m) continue;
    const [, pr, sha] = m;
    if (!byPr.has(pr)) byPr.set(pr, new Map());
    const shas = byPr.get(pr);
    if (!shas.has(sha) || Date.parse(shas.get(sha)) < t) shas.set(sha, r.createdAt);
  }
  const flagged = [];
  for (const [pr, shas] of byPr) {
    if (shas.size < thresholdAttempts) continue;
    const latest = [...shas.entries()].sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))[0];
    flagged.push({ pr: Number(pr), failedAttempts: shas.size, latestSha: latest[0], latestAt: latest[1] });
  }
  return flagged.sort((a, b) => b.failedAttempts - a.failedAttempts);
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function commentBody(f) {
  return (
    `${COMMENT_MARKER}\n` +
    `⚠️ **Merge-queue churn detected.** This PR has been removed from the merge queue ` +
    `**${f.failedAttempts}×** (failing \`merge_group\` CI) in the last 24h. Re-enabling auto-merge ` +
    `on the same commit will just churn again — it needs a **fix, not a retry**.\n\n` +
    `Open the latest \`merge_group\` CI run, address the failure, push the fix, then re-queue. ` +
    `A fast local reproduction often beats the queue loop (e.g. \`node scripts/check-golden-decisions.mjs\` ` +
    `for decision-baseline failures).`
  );
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  let runs;
  try {
    // Wide limit: at high merge volume a few hundred runs can be only a couple
    // hours of history, so pull generously to keep the 24h window meaningful for
    // a PR that has been churning a while. analyzeChurn() does the time filtering.
    runs = JSON.parse(gh(["run", "list", "--event", "merge_group", "--limit", "500", "--json", "headBranch,conclusion,createdAt"]));
  } catch (err) {
    console.error("[merge-queue-churn] could not list merge_group runs:", err.message);
    process.exit(0); // never fail the scheduled job on a transient gh/API error
  }

  const flagged = analyzeChurn(runs);
  if (flagged.length === 0) {
    console.log("[merge-queue-churn] no churning PRs in the window.");
    return;
  }

  if (dryRun) {
    for (const f of flagged) console.log(`[merge-queue-churn] (dry-run) PR #${f.pr}: ${f.failedAttempts} failed attempts (latest ${f.latestSha})`);
    return;
  }

  for (const f of flagged) {
    let view;
    try {
      view = JSON.parse(gh(["pr", "view", String(f.pr), "--json", "state,comments"]));
    } catch {
      console.log(`[merge-queue-churn] PR #${f.pr}: could not read — skip`);
      continue;
    }
    if (view.state !== "OPEN") {
      console.log(`[merge-queue-churn] PR #${f.pr} is ${view.state} — skip`);
      continue;
    }
    if ((view.comments ?? []).some((c) => (c.body ?? "").includes(COMMENT_MARKER))) {
      console.log(`[merge-queue-churn] PR #${f.pr} already flagged — skip`);
      continue;
    }
    gh(["pr", "comment", String(f.pr), "--body", commentBody(f)]);
    console.log(`[merge-queue-churn] flagged PR #${f.pr} (${f.failedAttempts} failed attempts).`);
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("check-merge-queue-churn.mjs");
if (invokedDirectly) main();
