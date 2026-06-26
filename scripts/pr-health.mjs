#!/usr/bin/env node
// scripts/pr-health.mjs
//
// Comprehensive PR merge-readiness checker.
//
// Why this exists: a recurring failure mode was reporting a PR "green / mergeable
// / queued" while a real blocker was still in place — because only a curated
// subset of signals was inspected. Across one wave this missed three distinct
// blocker classes, each of which actually blocked merge:
//   1. Non-"required" guards that still block (Module Size Guard, CodeQL, UX-Fit
//      Gate). The "only 4 checks block" assumption is WRONG as a detection filter.
//   2. PRs read mid-CI-run — "0 failing" while checks were still `pending` is a
//      transient, not a green.
//   3. Unresolved review threads — the repo requires conversation resolution, so
//      a single bot comment (e.g. an unused-import warning) blocks merge regardless
//      of checks. `gh pr checks` does NOT surface these; needs a GraphQL query.
//
// This tool collapses all three into ONE verdict so merge-readiness is mechanical,
// not a judgement call about which signals matter.
//
// Usage:
//   node scripts/pr-health.mjs            # the PR for the current branch
//   node scripts/pr-health.mjs <number>   # a specific PR
//   pnpm pr:health <number>
//
// Exit 0 = READY (every check terminal+green, mergeable != CONFLICTING, zero
// unresolved threads). Exit 1 = NOT READY (blockers enumerated). Exit 2 = usage/IO.
//
// Pure verdict logic lives in `evaluatePrHealth()` (unit-tested in
// scripts/pr-health.test.mjs); the rest is GitHub I/O via the `gh` CLI.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `gh pr checks --json` normalizes every check into a `bucket`:
//   pass | fail | pending | skipping | cancel
const FAILING_BUCKETS = new Set(["fail", "cancel"]);
const PENDING_BUCKETS = new Set(["pending"]);

/**
 * Decide whether a PR is merge-ready from its raw GitHub state. Pure + total.
 *
 * @param {{
 *   meta: { number?: number, title?: string, state?: string, mergeable?: string,
 *           mergeStateStatus?: string, isDraft?: boolean },
 *   checks: Array<{ name: string, bucket?: string, state?: string }>,
 *   threads: Array<{ isResolved: boolean, path?: string, line?: number }>,
 * }} input
 * @returns {{ ready: boolean, blockers: string[], notes: string[],
 *             counts: { checksTotal: number, failing: number, pending: number, unresolvedThreads: number } }}
 */
export function evaluatePrHealth({ meta = {}, checks = [], threads = [] } = {}) {
  const blockers = [];
  const notes = [];

  if (meta.state && meta.state !== "OPEN") {
    blockers.push(`PR state is ${meta.state} (not OPEN)`);
  }
  if (meta.isDraft) {
    blockers.push("PR is a draft — mark it ready for review");
  }
  if (meta.mergeable === "CONFLICTING") {
    blockers.push("mergeable=CONFLICTING — rebase onto origin/main and resolve conflicts");
  } else if (meta.mergeable === "UNKNOWN") {
    notes.push("mergeable=UNKNOWN — GitHub is still computing mergeability; re-run in a few seconds");
  }

  const failing = checks.filter((c) => FAILING_BUCKETS.has(c.bucket));
  const pending = checks.filter((c) => PENDING_BUCKETS.has(c.bucket));
  if (failing.length) {
    blockers.push(`${failing.length} failing check(s): ${failing.map((c) => c.name).join(", ")}`);
  }
  if (pending.length) {
    blockers.push(
      `${pending.length} check(s) not yet terminal (still running): ${pending.map((c) => c.name).join(", ")}` +
        " — wait for CI to finish before claiming green",
    );
  }

  const unresolved = threads.filter((t) => !t.isResolved);
  if (unresolved.length) {
    blockers.push(
      `${unresolved.length} unresolved review thread(s): ` +
        `${unresolved.map((t) => `${t.path ?? "?"}:${t.line ?? "?"}`).join(", ")} — ` +
        "address and resolve each conversation (the repo requires conversation resolution)",
    );
  }

  // mergeStateStatus is context, not a hard blocker on its own — the concrete
  // signals above are. A CLEAN-on-everything-else PR that is still BLOCKED is
  // almost always behind main / waiting its turn in the merge queue.
  if (blockers.length === 0 && meta.mergeStateStatus && meta.mergeStateStatus !== "CLEAN") {
    notes.push(
      `mergeStateStatus=${meta.mergeStateStatus} with no concrete blocker — typically behind main / ` +
        "queue-waiting; the merge queue rebases a clean PR. Do not rebase-spin; re-check after the queue runs.",
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    notes,
    counts: {
      checksTotal: checks.length,
      failing: failing.length,
      pending: pending.length,
      unresolvedThreads: unresolved.length,
    },
  };
}

// ---------------------------------------------------------------------------
// GitHub I/O (only runs when invoked as a CLI)
// ---------------------------------------------------------------------------

function gh(args, { allowFail = false } = {}) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    // `gh pr checks` exits non-zero when not every check passes, but still writes
    // the JSON to stdout — capture it.
    if (allowFail) return (e.stdout || "").toString();
    throw e;
  }
}

function fetchPrState(prArg) {
  let number = prArg;
  if (!number) {
    try {
      number = String(JSON.parse(gh(["pr", "view", "--json", "number"])).number);
    } catch {
      throw new Error("No PR found for the current branch. Pass a PR number: pr:health <number>");
    }
  }

  const meta = JSON.parse(
    gh(["pr", "view", number, "--json", "number,title,state,mergeable,mergeStateStatus,isDraft"]),
  );

  let checks = [];
  const rawChecks = gh(["pr", "checks", number, "--json", "name,state,bucket"], { allowFail: true });
  if (rawChecks.trim()) {
    try {
      checks = JSON.parse(rawChecks);
    } catch {
      /* no checks reported yet — treated as 0 checks */
    }
  }

  // Review threads are NOT in `gh pr checks` — fetch via GraphQL.
  let threads = [];
  try {
    const repo = JSON.parse(gh(["repo", "view", "--json", "owner,name"]));
    const query =
      "query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){" +
      "reviewThreads(first:100){nodes{isResolved isOutdated path line}}}}}";
    const data = JSON.parse(
      gh([
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `o=${repo.owner.login}`,
        "-F",
        `n=${repo.name}`,
        "-F",
        `p=${number}`,
      ]),
    );
    threads = data.data.repository.pullRequest.reviewThreads.nodes || [];
  } catch {
    /* threads unavailable (permissions / API) — report what we can */
  }

  return { meta, checks, threads };
}

function main() {
  let state;
  try {
    state = fetchPrState(process.argv[2]);
  } catch (e) {
    console.error(`pr-health: ${e.message}`);
    process.exit(2);
  }

  const result = evaluatePrHealth(state);
  const { meta } = state;
  const { counts } = result;

  console.log(`PR #${meta.number}: ${meta.title}`);
  console.log(`  state=${meta.state} mergeable=${meta.mergeable} mergeStateStatus=${meta.mergeStateStatus}`);
  console.log(
    `  checks: ${counts.checksTotal} total — ${counts.failing} failing, ${counts.pending} pending; ` +
      `${counts.unresolvedThreads} unresolved review thread(s)`,
  );
  for (const n of result.notes) console.log(`  note: ${n}`);

  if (result.ready) {
    console.log("READY TO MERGE — every check terminal+green, mergeable, zero unresolved threads.");
    process.exit(0);
  }
  console.log(`NOT READY — ${result.blockers.length} blocker(s):`);
  for (const b of result.blockers) console.log(`   - ${b}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
