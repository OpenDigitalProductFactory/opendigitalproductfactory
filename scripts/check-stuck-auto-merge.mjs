#!/usr/bin/env node
// scripts/check-stuck-auto-merge.mjs
//
// Stuck auto-merge alarm (BI-53BE1C77). PR #5333 sat SIX DAYS with auto-merge
// armed, `mergeStateStatus: BLOCKED` and red checks, and nothing surfaced it:
// auto-merge only fires when the PR turns green, GitHub sends no "it never
// turned green" signal, and the merge-queue churn watch (sibling script) only
// sees PRs that reached the queue — a PR blocked BEFORE the queue never does.
// The author believed the PR was on its way; it was parked.
//
// This watch closes that gap. On a schedule it lists open PRs with auto-merge
// enabled whose merge state is BLOCKED / DIRTY / BEHIND (or with a failing
// check) and which have been in that state for longer than a threshold, then
// posts ONE comment per stuck head SHA naming the failing checks and pointing at
// the build-gate runbook. A PR whose checks are still running is a transient,
// not a stuck PR (pr-health.mjs rule 2), and is never flagged.
//
// Pure `findStuckPullRequests()` + `shouldComment()` (unit-tested in
// check-stuck-auto-merge.test.mjs) and a thin gh CLI wrapper. Run on a schedule
// by .github/workflows/stuck-auto-merge-alarm.yml. `--dry-run` prints the
// analysis without commenting. `STUCK_PR_THRESHOLD_HOURS` overrides the 4h default.

import { execFileSync } from "node:child_process";

export const COMMENT_MARKER = "<!-- stuck-auto-merge-alarm";
export const DEFAULT_THRESHOLD_HOURS = 4;
export const RUNBOOK_PATH = "docs/architecture/build-gate-runbook.md";

/** Merge states in which auto-merge cannot fire without a human acting. */
export const STUCK_MERGE_STATES = new Set(["BLOCKED", "DIRTY", "BEHIND"]);

const FAILING_CHECK_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const FAILING_STATUS_STATES = new Set(["FAILURE", "ERROR"]);

/** A `statusCheckRollup` entry is either a CheckRun (status/conclusion) or a
 *  StatusContext (state). Normalise both into {name, verdict, url, at}. */
export function classifyCheck(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.__typename === "StatusContext" || typeof entry.state === "string") {
    const state = String(entry.state ?? "").toUpperCase();
    const verdict = FAILING_STATUS_STATES.has(state) ? "failing" : state === "SUCCESS" ? "passing" : "pending";
    return { name: entry.context ?? entry.name ?? "status", verdict, url: entry.targetUrl ?? null, at: entry.createdAt ?? null };
  }
  const status = String(entry.status ?? "").toUpperCase();
  const conclusion = String(entry.conclusion ?? "").toUpperCase();
  let verdict;
  if (status !== "COMPLETED") verdict = "pending";
  else if (FAILING_CHECK_CONCLUSIONS.has(conclusion)) verdict = "failing";
  else verdict = "passing"; // SUCCESS, SKIPPED, NEUTRAL — none block a merge
  const name = entry.workflowName && entry.name ? `${entry.workflowName} / ${entry.name}` : entry.name ?? "check";
  // A running check reports completedAt as the year-0001 sentinel; its start is the honest time.
  const at = verdict === "pending" ? entry.startedAt ?? null : entry.completedAt ?? null;
  return { name, verdict, url: entry.detailsUrl ?? null, at };
}

function parseTime(iso) {
  const t = Date.parse(iso ?? "");
  // GitHub's "not yet" sentinel (0001-01-01) is not a time anything happened.
  return Number.isNaN(t) || t <= 0 ? null : t;
}

/**
 * Decide which open PRs are stuck. Pure.
 *
 * A PR is stuck when ALL hold:
 *   - it is open, not a draft, and auto-merge is enabled (`autoMergeRequest` non-null;
 *     a PR already IN the merge queue reports null and is the churn watch's job);
 *   - its merge state is BLOCKED/DIRTY/BEHIND, OR at least one check is failing;
 *   - no check is still pending — unless it has been pending for >= thresholdHours,
 *     which is a hung run, not a mid-CI read (a hung required check parks the PR
 *     exactly as a red one does, and reads as "still running" to a human);
 *   - it has been that way for >= thresholdHours, measured from the LATEST of:
 *     auto-merge enabledAt, the head commit's committedDate, and the newest failing
 *     check's completion time. Each of those is "the last moment someone or something
 *     acted"; the clock restarts on any of them so a fresh push is never flagged early.
 *
 * @param {Array<object>} prs  `gh pr list --json` rows
 * @param {{thresholdHours?:number, now?:number}} [opts]
 * @returns {Array<{number:number, url:string, title:string, headSha:string, mergeStateStatus:string, stuckHours:number, failingChecks:Array<{name:string,url:string|null}>}>}
 */
export function findStuckPullRequests(prs, { thresholdHours = DEFAULT_THRESHOLD_HOURS, now = Date.now() } = {}) {
  const thresholdMs = thresholdHours * 3600 * 1000;
  const stuck = [];
  for (const pr of prs ?? []) {
    if (!pr || pr.isDraft === true) continue;
    if (pr.state && String(pr.state).toUpperCase() !== "OPEN") continue;
    if (!pr.autoMergeRequest) continue;

    const checks = (pr.statusCheckRollup ?? []).map(classifyCheck).filter(Boolean);
    const pending = checks.filter((c) => c.verdict === "pending");
    const hung = pending.filter((c) => {
      const started = parseTime(c.at);
      return started !== null && now - started >= thresholdMs;
    });
    if (pending.length > hung.length) continue; // something is genuinely still running
    const failing = [
      ...checks.filter((c) => c.verdict === "failing"),
      ...hung.map((c) => ({ ...c, name: `${c.name} (still running after ${Math.floor((now - parseTime(c.at)) / 3600 / 1000)}h)` })),
    ];
    const mergeState = String(pr.mergeStateStatus ?? "").toUpperCase();
    if (!STUCK_MERGE_STATES.has(mergeState) && failing.length === 0) continue;

    const commits = pr.commits ?? [];
    const lastCommitAt = commits.length ? parseTime(commits[commits.length - 1]?.committedDate) : null;
    const reference = Math.max(
      parseTime(pr.autoMergeRequest.enabledAt) ?? 0,
      lastCommitAt ?? 0,
      ...failing.map((c) => parseTime(c.at) ?? 0),
    );
    if (reference === 0) continue; // no usable timestamp — cannot claim an age
    const stuckMs = now - reference;
    if (stuckMs < thresholdMs) continue;

    stuck.push({
      number: pr.number,
      url: pr.url ?? "",
      title: pr.title ?? "",
      headSha: pr.headRefOid ?? "",
      mergeStateStatus: mergeState || "UNKNOWN",
      stuckHours: Math.floor(stuckMs / 3600 / 1000),
      failingChecks: failing.map((c) => ({ name: c.name, url: c.url })),
    });
  }
  return stuck.sort((a, b) => b.stuckHours - a.stuckHours);
}

/** Marker for one head SHA. A new push that gets stuck again is new information
 *  and earns a new comment; the same SHA never earns a second one. */
export function markerFor(headSha) {
  return `${COMMENT_MARKER} head=${headSha} -->`;
}

/** True iff no existing comment already carries this head's marker. Pure. */
export function shouldComment(comments, headSha) {
  const marker = markerFor(headSha);
  return !(comments ?? []).some((c) => typeof c?.body === "string" && c.body.includes(marker));
}

export function commentBody(f, { repo, thresholdHours = DEFAULT_THRESHOLD_HOURS } = {}) {
  const runbookUrl = repo ? `https://github.com/${repo}/blob/main/${RUNBOOK_PATH}` : RUNBOOK_PATH;
  const checks = f.failingChecks.length
    ? f.failingChecks.map((c) => (c.url ? `- [${c.name}](${c.url})` : `- ${c.name}`)).join("\n")
    : "- (no failing check — the merge state is " +
      `\`${f.mergeStateStatus}\`: look for unresolved review threads, a missing required check, a stale base branch, or a conflict)`;
  return (
    `${markerFor(f.headSha)}\n` +
    `⚠️ **Auto-merge is armed but this PR cannot merge.** It has been \`${f.mergeStateStatus}\` for about ` +
    `**${f.stuckHours}h** (alarm threshold ${thresholdHours}h) at \`${f.headSha.slice(0, 7)}\`. Auto-merge will not fire ` +
    `until every check is green, and nothing else will tell you it is parked.\n\n` +
    `**Failing checks:**\n${checks}\n\n` +
    `Fix and push (a new head gets a fresh alarm if it sticks again), or close the PR. ` +
    `\`pnpm pr:health ${f.number}\` gives the mechanical verdict; the [build-gate runbook](${runbookUrl}) ` +
    `covers the recurring causes (a force-push clears auto-merge; a PR-body gate needs a new push, not a rerun).`
  );
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function resolveRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const v = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"]));
    return v.nameWithOwner ?? null;
  } catch {
    return null;
  }
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const thresholdHours = Number(process.env.STUCK_PR_THRESHOLD_HOURS) || DEFAULT_THRESHOLD_HOURS;
  let prs;
  try {
    // `commits` is deliberately NOT requested here: across 200 PRs it trips
    // GitHub's GraphQL node budget ("requesting up to 1,000,000 possible
    // nodes"). It is fetched per candidate below, where it is one PR at a time.
    prs = JSON.parse(
      gh([
        "pr", "list", "--state", "open", "--limit", "200", "--json",
        "number,url,title,isDraft,state,headRefOid,autoMergeRequest,mergeStateStatus,statusCheckRollup",
      ]),
    );
  } catch (err) {
    console.error("[stuck-auto-merge] could not list open PRs:", err.message);
    process.exit(0); // never fail the scheduled job on a transient gh/API error
  }

  // Without commit dates the age can only be OVER-estimated (a push restarts
  // the clock), so this candidate set is a superset of the truly stuck PRs; the
  // real verdict is taken per candidate once its commits are known.
  const candidates = findStuckPullRequests(prs, { thresholdHours });
  if (candidates.length === 0) {
    console.log(`[stuck-auto-merge] no PR has been stuck with auto-merge armed for >= ${thresholdHours}h.`);
    return;
  }

  const repo = resolveRepo();
  for (const candidate of candidates) {
    const listed = prs.find((p) => p.number === candidate.number);
    let view;
    try {
      view = JSON.parse(gh(["pr", "view", String(candidate.number), "--json", "state,comments,commits"]));
    } catch {
      console.log(`[stuck-auto-merge] PR #${candidate.number}: could not read — skip`);
      continue;
    }
    if (view.state !== "OPEN") {
      console.log(`[stuck-auto-merge] PR #${candidate.number} is ${view.state} — skip`);
      continue;
    }
    const [f] = findStuckPullRequests([{ ...listed, commits: view.commits }], { thresholdHours });
    if (!f) {
      console.log(`[stuck-auto-merge] PR #${candidate.number}: pushed inside the threshold — not stuck yet`);
      continue;
    }
    const summary = `PR #${f.number}: ${f.mergeStateStatus} for ${f.stuckHours}h at ${f.headSha.slice(0, 7)}, ` +
      `${f.failingChecks.length} failing check(s)${f.failingChecks.length ? ": " + f.failingChecks.map((c) => c.name).join(", ") : ""}`;
    if (dryRun) {
      console.log(`[stuck-auto-merge] (dry-run) ${summary}`);
      continue;
    }
    if (!shouldComment(view.comments, f.headSha)) {
      console.log(`[stuck-auto-merge] PR #${f.number} already flagged at ${f.headSha.slice(0, 7)} — skip`);
      continue;
    }
    gh(["pr", "comment", String(f.number), "--body", commentBody(f, { repo, thresholdHours })]);
    console.log(`[stuck-auto-merge] flagged ${summary}`);
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("check-stuck-auto-merge.mjs");
if (invokedDirectly) main();
