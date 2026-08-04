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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Single SoT for override codes (BI-563F6AB6) — shared with PreToolUse guards.
import {
  LOCAL_CI_OVERRIDE_REASON_CODES,
  classifyLocalCiOverride,
} from "../packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs";

export { LOCAL_CI_OVERRIDE_REASON_CODES, classifyLocalCiOverride };

// `gh pr checks --json` normalizes every check into a `bucket`:
//   pass | fail | pending | skipping | cancel
const FAILING_BUCKETS = new Set(["fail", "cancel"]);
const PENDING_BUCKETS = new Set(["pending"]);

// PR-body attestation trailers for the local-CI sandbox gate (BI-C74F4DE9).
// `Local-CI-Evidence:` carries an evidence record id from a passing
// `pnpm run pregate` run; `Local-CI-Override:` is an explicit operator
// attestation that the sandbox gate was consciously skipped and why.
// BI-563F6AB6: Override values must use a closed reason code (see local-ci-override.mjs).
const LOCAL_CI_TRAILER_RE = /^\s*Local-CI-(Evidence|Override):\s*(\S.*)$/m;

export function parseLocalCiAttestation(prBody) {
  const match = LOCAL_CI_TRAILER_RE.exec(prBody || "");
  if (!match) return null;
  return { kind: match[1].toLowerCase(), value: match[2].trim() };
}

const DOCS_ONLY_RE = /^docs\/|^memory\/|\.md$/;

export function isDocsOnlyFileSet(files) {
  if (!Array.isArray(files) || files.length === 0) return false;
  return files.every((f) => DOCS_ONLY_RE.test(typeof f === "string" ? f : f?.path ?? ""));
}

/**
 * Decide whether a PR is merge-ready from its raw GitHub state. Pure + total.
 *
 * @param {{
 *   meta: { number?: number, title?: string, state?: string, mergeable?: string,
 *           mergeStateStatus?: string, isDraft?: boolean },
 *   checks: Array<{ name: string, bucket?: string, state?: string }>,
 *   threads: Array<{ isResolved: boolean, path?: string, line?: number }>,
 *   localCi?: {
 *     headSha?: string,
 *     docsOnly?: boolean,
 *     attestation?: { kind: string, value: string } | null,
 *     stateRecord?: { branch?: string, sha?: string, gatePassed?: boolean,
 *                     skipped?: boolean, skipReason?: string } | null,
 *   } | null,
 * }} input
 * @returns {{ ready: boolean, blockers: string[], notes: string[],
 *             counts: { checksTotal: number, failing: number, pending: number, unresolvedThreads: number } }}
 */
export function evaluatePrHealth({ meta = {}, checks = [], threads = [], localCi = null } = {}) {
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

  // Local-CI sandbox evidence (BI-C74F4DE9 + BI-563F6AB6 P1): a runtime-code PR
  // must carry a passing local-integration-ci gate for its head SHA, a recorded
  // pre-push override with an allowlisted reason code, or a PR-body attestation
  // (Evidence id, or Override with allowlisted code). Free-text overrides are
  // blockers — agents cannot green-wash "unit tests only".
  if (localCi) {
    const rec = localCi.stateRecord;
    const recMatchesHead = rec && localCi.headSha && rec.sha === localCi.headSha;
    if (localCi.docsOnly) {
      notes.push("local-CI gate not required — docs-only change set");
    } else if (recMatchesHead && rec.gatePassed === true) {
      notes.push(`local-CI sandbox gate passed for head ${localCi.headSha.slice(0, 12)}`);
    } else if (recMatchesHead && rec.skipped && rec.skipReason) {
      const classified = classifyLocalCiOverride(rec.skipReason);
      if (classified.ok) {
        notes.push(
          `local-CI gate overridden at push time (code=${classified.code}` +
            (classified.detail ? `; ${classified.detail}` : "") +
            ")",
        );
      } else {
        blockers.push(
          `local-CI push-time override rejected: ${classified.reason}`,
        );
      }
    } else if (localCi.attestation) {
      if (localCi.attestation.kind === "evidence") {
        notes.push(
          `local-CI evidence attestation in PR body: ${localCi.attestation.value}`,
        );
      } else if (localCi.attestation.kind === "override") {
        const classified = classifyLocalCiOverride(localCi.attestation.value);
        if (classified.ok) {
          notes.push(
            `local-CI override attestation in PR body (code=${classified.code}` +
              (classified.detail ? `; ${classified.detail}` : "") +
              ")",
          );
        } else {
          blockers.push(
            `local-CI PR-body override rejected: ${classified.reason}`,
          );
        }
      } else {
        blockers.push(
          `unknown local-CI attestation kind ${JSON.stringify(localCi.attestation.kind)}`,
        );
      }
    } else {
      blockers.push(
        "no local-CI sandbox evidence for the PR head SHA — run `pnpm run pregate` from the " +
          "branch worktree (claims the local-integration-ci lease, runs the checked-in runner, " +
          "records evidence), or add `Local-CI-Evidence: <record-id>` / " +
          `Local-CI-Override: <code>[: detail] where <code> is one of: ` +
          `${LOCAL_CI_OVERRIDE_REASON_CODES.join(", ")}`,
      );
    }
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
    gh(["pr", "view", number, "--json", "number,title,state,mergeable,mergeStateStatus,isDraft,headRefOid,body,files"]),
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

  // Local-CI sandbox evidence inputs (BI-C74F4DE9). The git-local gate record
  // only proves anything when pr:health runs from the branch's own worktree;
  // for remote PRs the PR-body attestation trailer is the portable signal.
  let stateRecord = null;
  try {
    const stateFile = execFileSync("git", ["rev-parse", "--git-path", "dpf-local-ci-gate.json"], {
      encoding: "utf8",
    }).trim();
    stateRecord = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    /* no local gate record — attestation/docs-only carry the verdict */
  }
  const localCi = {
    headSha: meta.headRefOid,
    docsOnly: isDocsOnlyFileSet(meta.files),
    attestation: parseLocalCiAttestation(meta.body),
    stateRecord,
  };

  return { meta, checks, threads, localCi };
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
