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
import {
  createEvidencePlan,
  loadEvidencePolicy,
} from "./lib/ci-evidence-plan.mjs";

// Single SoT for override codes (BI-563F6AB6) — shared with PreToolUse guards.
import {
  LOCAL_CI_OVERRIDE_REASON_CODES,
  classifyLocalCiOverride,
} from "../packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import {
  LOCAL_CI_SLOT_KEYS,
  createLocalCiSlotManifest,
} from "./lib/local-ci-slot-manifest.mjs";
import { resolveWorktreeContext } from "./pregate-status.mjs";

export { LOCAL_CI_OVERRIDE_REASON_CODES, classifyLocalCiOverride };

/**
 * BI-5529B5AC. Gate state is written PER SLOT (scripts/lib/local-ci-slot-manifest.mjs):
 * slot-0 → dpf-local-ci-gate.json, slot-1 → dpf-local-ci-gate-slot-1.json.
 * This tool used to open the slot-0 file only, so a PASS earned on slot-1 read
 * as "no evidence" here even while `pregate:status` reported PASS. Choose the
 * record the way the reader does — a PASS bound to HEAD on ANY slot wins —
 * then fall back to a recorded override for HEAD, then to slot-0 (the legacy
 * answer) so the messages below keep their meaning.
 *
 * @param {{ headSha: string, records: Array<{ slotKey: string, state: any }>, now?: number }} input
 * @returns {{ slotKey: string, state: any } | null}
 */
export function selectLocalCiStateRecord({ headSha, records, now = Date.now() }) {
  const usable = (records || []).filter((r) => r && r.state && typeof r.state === "object");
  if (usable.length === 0) return null;
  const forHead = usable.filter((r) => headSha && r.state.sha === headSha);
  const livePass = forHead.find((r) => {
    if (r.state.gatePassed !== true || r.state.evidencePending === true) return false;
    const expiry = Date.parse(r.state.expiresAt || "");
    return !Number.isFinite(expiry) || expiry > now;
  });
  if (livePass) return livePass;
  const override = forHead.find((r) => r.state.skipped && r.state.skipReason);
  if (override) return override;
  return usable.find((r) => r.slotKey === LOCAL_CI_SLOT_KEYS[0]) || forHead[0] || usable[0];
}

function readLocalCiSlotRecords() {
  const context = resolveWorktreeContext();
  if (!context) return [];
  return LOCAL_CI_SLOT_KEYS.map((slotKey) => {
    const manifest = createLocalCiSlotManifest({
      slotKey,
      rootClone: context.rootClone,
      gitCommonDir: context.gitCommonDir,
      candidateGitDir: context.candidateGitDir,
    });
    try {
      return { slotKey, state: JSON.parse(readFileSync(manifest.evidence.state, "utf8")) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// `gh pr checks --json` normalizes every check into a `bucket`:
//   pass | fail | pending | skipping | cancel
const FAILING_BUCKETS = new Set(["fail", "cancel"]);
const PENDING_BUCKETS = new Set(["pending"]);

// Commit/PR attestation trailers for the local-CI sandbox gate (BI-C74F4DE9).
// `Local-CI-Evidence:` carries an evidence record id from a passing
// `pnpm run pregate` run; `Local-CI-Override:` is an explicit operator
// attestation that the sandbox gate was consciously skipped and why.
// BI-563F6AB6: Override values must use a closed reason code (see local-ci-override.mjs).
const LOCAL_CI_TRAILER_RE = /^\s*Local-CI-(Evidence|Override):\s*(\S.*)$/m;

export function parseLocalCiAttestation(prBody, commitMessages = []) {
  // Commit trailers are durable and create a fresh webhook payload when pushed;
  // prefer them over the mutable PR body, whose value is frozen in an already-
  // running pull_request event. Body parsing stays as a compatibility fallback.
  for (const source of [...commitMessages, prBody]) {
    const match = LOCAL_CI_TRAILER_RE.exec(source || "");
    if (match) return { kind: match[1].toLowerCase(), value: match[2].trim() };
  }
  return null;
}

const evidencePolicy = loadEvidencePolicy();

export function isDocsOnlyFileSet(files) {
  if (!Array.isArray(files) || files.length === 0) return false;
  const changedFiles = files.map((file) => (
    typeof file === "string" ? file : file?.path ?? ""
  ));
  const plan = createEvidencePlan({
    eventName: "pull_request",
    baseSha: "pr-health-base",
    headSha: "pr-health-head",
    baseTreeSha: "pr-health-base-tree",
    headTreeSha: "pr-health-head-tree",
    changedFiles,
    knownTests: [],
    relatedTestsBySource: {},
    routeAdviceBySource: {},
    packageDependencies: {},
    totalTestCount: 0,
    policy: evidencePolicy,
  });
  return plan.scope.docsOnly && !plan.fullSuite;
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
  // AGENTS.md §3: "All changes land via PR against `main`." That is not just
  // convention here — .github/workflows/ci.yml triggers on
  // `pull_request: branches: [main]`, so a PR based on anything else runs only
  // DCO / classify / acceptance. No Typecheck, no Unit Tests, no Policy Guards,
  // no Production Build — and `mergeStateStatus` still reports CLEAN, because
  // every required check it knows about did pass. This function is the
  // mechanical merge-readiness answer doctrine points at, so it is where the
  // off-contract base has to stop being invisible (#4483, 2026-08-23).
  if (meta.baseRefName && meta.baseRefName !== "main") {
    blockers.push(
      `base is ${meta.baseRefName}, not main — AGENTS.md §3 requires PRs against main, and ` +
        "ci.yml only runs the heavy suite (Typecheck, Unit Tests, Policy Guards, Production " +
        "Build) for main-based PRs. Green here does NOT mean verified. Rebase onto origin/main " +
        "and retarget the PR.",
    );
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
  // pre-push override with an allowlisted reason code, or a commit/PR attestation
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
          `local-CI evidence attestation in commit history or PR body: ${localCi.attestation.value}`,
        );
      } else if (localCi.attestation.kind === "override") {
        const classified = classifyLocalCiOverride(localCi.attestation.value);
        if (classified.ok) {
          notes.push(
            `local-CI override attestation in commit history or PR body (code=${classified.code}` +
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
    gh(["pr", "view", number, "--json", "number,title,state,mergeable,mergeStateStatus,isDraft,baseRefName,headRefOid,body,files,commits"]),
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
  // for remote PRs a commit trailer is the durable signal; PR body remains a
  // compatibility fallback for older contributions.
  // Every slot's record is consulted, not just slot-0 (BI-5529B5AC).
  let stateRecord = null;
  try {
    stateRecord = selectLocalCiStateRecord({
      headSha: meta.headRefOid,
      records: readLocalCiSlotRecords(),
    })?.state ?? null;
  } catch {
    /* no local gate record — attestation/docs-only carry the verdict */
  }
  const localCi = {
    headSha: meta.headRefOid,
    docsOnly: isDocsOnlyFileSet(meta.files),
    attestation: parseLocalCiAttestation(
      meta.body,
      (meta.commits ?? []).map((commit) =>
        [commit.messageHeadline, commit.messageBody].filter(Boolean).join("\n\n")),
    ),
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

if (isEntryModule(import.meta.url)) main();
