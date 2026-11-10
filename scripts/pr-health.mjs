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
//   pnpm pr:health <number> --wait [--timeout <minutes, default 30>]
//                                         # poll until the verdict is terminal
//
// The first output line is the verdict word, and the exit code says the same
// thing (BI-F197C997 — "still running" used to exit 1, and agents read it as a
// failure 154 times in 15 threads):
//   0  READY or MERGED — every check terminal+green, mergeable, zero unresolved threads
//   1  FAILED          — a check failed; the line names it
//   2  BLOCKED-ACTION  — someone must act (conflict, review thread, draft, missing
//                        local-CI evidence, closed PR); the line names who
//   3  UNREADABLE      — usage error, or GitHub could not be read
//   75 WAITING         — only pending checks stand between the PR and READY;
//                        wait (or pass --wait), never treat it as a failure
//
// Pure verdict logic lives in `evaluatePrHealth()` (unit-tested in
// scripts/pr-health.test.mjs); the rest is GitHub I/O via the `gh` CLI.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs as utilParseArgs } from "node:util";
import { scriptArgv } from "./lib/script-argv.mjs";
import {
  createEvidencePlan,
  loadEvidencePolicy,
} from "./lib/ci-evidence-plan.mjs";

// Single SoT for override codes (BI-563F6AB6) — shared with PreToolUse guards.
import {
  GATE_INFRASTRUCTURE_UNAVAILABLE_CODE,
  LOCAL_CI_OVERRIDE_REASON_CODES,
  classifyGateInfrastructureEvidence,
  classifyLocalCiOverride,
} from "../packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { classifyPublishedCorrection } from "../packages/dpf-skill-pack/hooks/lib/published-correction.mjs";
import { inspectCorrectionRecord } from "./published-correction.mjs";
import { isTestStubGateRecord } from "./lib/local-ci-gate-state.mjs";
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
    // BI-53B189C8: a stub run passes without building anything.
    if (isTestStubGateRecord(r.state)) return false;
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
 * BI-F197C997. One exit code per kind of answer, so a caller can tell "wait"
 * from "fix" from "someone must act" without parsing text. 75 is EX_TEMPFAIL,
 * the same code pregate and pregate:status use for "still working".
 */
export const PR_HEALTH_EXIT = Object.freeze({
  READY: 0,
  MERGED: 0,
  FAILED: 1,
  "BLOCKED-ACTION": 2,
  UNREADABLE: 3,
  WAITING: 75,
});

/**
 * Longest remaining time across pending checks whose workflow has a typical
 * duration, or null when none does. An estimate, never a promise: a check
 * already past its typical duration reports 0, not a negative.
 */
function estimateRemainingMs(pending, typicalDurationsMs, now) {
  let longest = null;
  for (const check of pending) {
    const typical = typicalDurationsMs?.[check.workflow];
    const started = Date.parse(check.startedAt || "");
    if (!Number.isFinite(typical) || !Number.isFinite(started)) continue;
    const remaining = Math.max(0, typical - (now - started));
    longest = longest === null ? remaining : Math.max(longest, remaining);
  }
  return longest;
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
 * `typicalDurationsMs` maps a check's workflow name to its usual run time, for
 * the WAITING ETA; absent or unknown workflows simply have no ETA.
 *
 * @returns {{ ready: boolean, verdict: "READY"|"MERGED"|"FAILED"|"BLOCKED-ACTION"|"WAITING",
 *             exitCode: number, failingChecks: string[], waitingOn: string[],
 *             actions: Array<{ actor: string, text: string }>, etaMs: number|null,
 *             blockers: string[], notes: string[],
 *             counts: { checksTotal: number, failing: number, pending: number, unresolvedThreads: number } }}
 */
export function evaluatePrHealth({ meta = {}, checks = [], threads = [], localCi = null, typicalDurationsMs = {}, now = Date.now() } = {}) {
  const notes = [];
  // BI-F197C997: every blocker is one of three kinds, because each asks for a
  // different response. A failed check needs a fix; an action needs a named
  // actor; a pending check needs nothing but time. `blockers` keeps the full
  // human list; the kinds drive the verdict and the exit code.
  const blockers = [];
  const actions = [];
  const author = meta.author?.login ? `PR author (@${meta.author.login})` : "PR author";
  const actBy = (actor, text) => {
    actions.push({ actor, text });
    blockers.push(text);
  };
  // The local-CI section below names the author for every blocker it raises.
  const localCiBlockers = { push: (text) => actBy(author, text) };

  if (meta.state && meta.state !== "OPEN") {
    if (meta.state === "MERGED") blockers.push("PR state is MERGED (not OPEN)");
    else actBy("PR owner", `PR state is ${meta.state} (not OPEN) — the owner must reopen it, or the work lands through another PR`);
  }
  if (meta.isDraft) {
    actBy(author, "PR is a draft — mark it ready for review");
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
    actBy(author,
      `base is ${meta.baseRefName}, not main — AGENTS.md §3 requires PRs against main, and ` +
        "ci.yml only runs the heavy suite (Typecheck, Unit Tests, Policy Guards, Production " +
        "Build) for main-based PRs. Green here does NOT mean verified. Rebase onto origin/main " +
        "and retarget the PR.",
    );
  }
  if (meta.mergeable === "CONFLICTING") {
    actBy(author, "mergeable=CONFLICTING — rebase onto origin/main and resolve conflicts");
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
    actBy(author,
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
    // Every local-CI blocker is an author action (run the gate, fix the override),
    // so this block's pushes go through actBy.
    const blockers = localCiBlockers;
    const rec = localCi.stateRecord;
    // BI-53B189C8: a DPF_ALLOW_LOCAL_CI_STUB record says passed without building
    // anything. It counts as no record at all, and the blocker names it.
    const stubForHead = Boolean(rec && localCi.headSha && rec.sha === localCi.headSha && isTestStubGateRecord(rec));
    const recMatchesHead = rec && localCi.headSha && rec.sha === localCi.headSha && !stubForHead;
    if (localCi.docsOnly) {
      notes.push("local-CI gate not required — docs-only change set");
    } else if (recMatchesHead && rec.gatePassed === true) {
      notes.push(`local-CI sandbox gate passed for head ${localCi.headSha.slice(0, 12)}`);
    } else if (recMatchesHead && rec.skipped && rec.skipReason) {
      const classified = classifyLocalCiOverride(rec.skipReason);
      if (classified.ok && classified.code === "published-correction") {
        const qualified = classifyPublishedCorrection(rec, { sha: localCi.headSha, branch: localCi.headBranch ?? rec.branch, repositoryFullName: localCi.repositoryFullName, now });
        if (qualified.ok && localCi.publicationInspection?.ok === true && localCi.publicationInspection.state === rec) notes.push(qualified.reason);
        else if (qualified.ok) blockers.push("Published correction lacks fresh source/plan/environment/protection inspection.");
        else blockers.push(qualified.reason);
      } else if (classified.ok && classified.code === GATE_INFRASTRUCTURE_UNAVAILABLE_CODE) {
        // BI-02E5F2A1: this code is evidence-gated, not attestation-gated. The
        // hook's probe must have captured the failed lease claim; the push is
        // reported as gate-UNRUN, never passed, and cloud CI is the safety net.
        const evidence = classifyGateInfrastructureEvidence(rec.infrastructureEvidence);
        if (evidence.ok) {
          notes.push(
            `local-CI gate UNRUN for head ${localCi.headSha.slice(0, 12)} — gate infrastructure unavailable ` +
              `at push time (${evidence.kind}: ${evidence.message}); NOT a pass — cloud CI is the safety net`,
          );
        } else {
          blockers.push(`local-CI push-time override rejected: ${evidence.reason}`);
        }
      } else if (classified.ok) {
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
        if (classified.ok && classified.code === "published-correction") {
          blockers.push("Published correction requires current-head machine proof; a prose trailer cannot delegate integration.");
        } else if (classified.ok && classified.code === GATE_INFRASTRUCTURE_UNAVAILABLE_CODE) {
          // A PR-body/commit trailer is prose; the only evidence for this code
          // is what the hook captured at push time in the gate record.
          blockers.push(
            `local-CI PR-body override rejected: ${GATE_INFRASTRUCTURE_UNAVAILABLE_CODE} is accepted only ` +
              "as a push-time record carrying the hook's captured lease-claim failure — a trailer is prose, not evidence",
          );
        } else if (classified.ok) {
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
    } else if (stubForHead) {
      blockers.push(
        `the local-CI record for head ${localCi.headSha.slice(0, 12)} was written by the ` +
          `DPF_ALLOW_LOCAL_CI_STUB=1 test stub (branch ${rec.branch || "unknown"}) — no sandbox build ran, ` +
          "so it is not evidence. Run `pnpm run pregate` from the branch worktree.",
      );
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

  let verdict = "READY";
  if (meta.state === "MERGED") verdict = "MERGED";
  else if (failing.length) verdict = "FAILED";
  else if (actions.length) verdict = "BLOCKED-ACTION";
  else if (pending.length) verdict = "WAITING";
  else if (blockers.length) verdict = "BLOCKED-ACTION";

  return {
    ready: blockers.length === 0,
    verdict,
    exitCode: PR_HEALTH_EXIT[verdict],
    failingChecks: failing.map((c) => c.name),
    waitingOn: pending.map((c) => c.name),
    actions,
    etaMs: verdict === "WAITING" ? estimateRemainingMs(pending, typicalDurationsMs, now) : null,
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
    gh(["pr", "view", number, "--json", "number,title,state,mergeable,mergeStateStatus,isDraft,baseRefName,headRefName,headRefOid,body,files,commits,author"]),
  );

  let checks = [];
  const rawChecks = gh(["pr", "checks", number, "--json", "name,state,bucket,workflow,startedAt"], { allowFail: true });
  if (rawChecks.trim()) {
    try {
      checks = JSON.parse(rawChecks);
    } catch {
      /* no checks reported yet — treated as 0 checks */
    }
  }

  // Review threads are NOT in `gh pr checks` — fetch via GraphQL.
  let threads = [];
  let repositoryFullName = null;
  try {
    const repo = JSON.parse(gh(["repo", "view", "--json", "owner,name"]));
    repositoryFullName = `${repo.owner.login}/${repo.name}`;
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
  let publicationInspection = null;
  try {
    stateRecord = selectLocalCiStateRecord({
      headSha: meta.headRefOid,
      records: readLocalCiSlotRecords(),
    })?.state ?? null;
    const inspected = inspectCorrectionRecord();
    const correction = inspected.ok ? inspected.state : null;
    if (repositoryFullName && correction?.sha === meta.headRefOid
      && classifyPublishedCorrection(correction, { sha: meta.headRefOid, branch: meta.headRefName, repositoryFullName }).ok) {
      stateRecord = correction;
      publicationInspection = inspected;
    }
  } catch {
    /* no local gate record — attestation/docs-only carry the verdict */
  }
  const localCi = {
    headSha: meta.headRefOid,
    headBranch: meta.headRefName,
    repositoryFullName,
    publicationInspection,
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

/**
 * Typical successful run time per workflow, from its recent runs on main — the
 * basis for a WAITING ETA. Best-effort: any workflow gh cannot answer for is
 * simply absent, and the verdict then says the ETA is unknown.
 */
function fetchTypicalWorkflowDurations(workflows, cache = new Map()) {
  const out = {};
  for (const workflow of new Set(workflows.filter(Boolean))) {
    if (!cache.has(workflow)) {
      let median = null;
      try {
        const runs = JSON.parse(gh([
          "run", "list", "--workflow", workflow, "--branch", "main", "--status", "success",
          "--limit", "5", "--json", "startedAt,updatedAt",
        ]));
        const durations = runs
          .map((run) => Date.parse(run.updatedAt) - Date.parse(run.startedAt))
          .filter((ms) => Number.isFinite(ms) && ms > 0)
          .sort((a, b) => a - b);
        if (durations.length) median = durations[Math.floor(durations.length / 2)];
      } catch {
        /* unknown — no ETA for this workflow */
      }
      cache.set(workflow, median);
    }
    if (cache.get(workflow) !== null) out[workflow] = cache.get(workflow);
  }
  return out;
}

/** `[<pr>] [--wait] [--timeout <minutes>] [--interval <seconds>]` */
export function parsePrHealthArgs(argv = process.argv.slice(2)) {
  const { values, positionals } = utilParseArgs({
    args: scriptArgv(argv),
    options: {
      wait: { type: "boolean", default: false },
      timeout: { type: "string" },
      interval: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const number = (flag, raw, fallback) => {
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} needs a positive number, got ${JSON.stringify(raw)}`);
    return parsed;
  };
  return {
    pr: positionals[0] ?? "",
    wait: values.wait === true,
    timeoutMinutes: number("--timeout", values.timeout, 30),
    intervalSeconds: number("--interval", values.interval, 30),
  };
}

/**
 * `--wait`: read until the verdict is terminal (anything but WAITING) or the
 * timeout passes. The tool does the polling so an agent makes ONE bounded call
 * instead of interpreting each intermediate state.
 */
export async function waitForPrHealth({ read, sleep, now = () => Date.now(), timeoutMs, intervalMs, onPoll = () => {} }) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const result = await read();
    onPoll(result);
    if (result.verdict !== "WAITING") return result;
    if (now() + intervalMs > deadline) return { ...result, timedOut: true };
    await sleep(intervalMs);
  }
}

function formatEta(ms) {
  if (ms === null || ms === undefined) return "ETA unknown";
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "ETA under a minute" : `ETA ~${minutes}m`;
}

/** The verdict line: one word, then what to do about it. */
export function verdictHeadline(result) {
  switch (result.verdict) {
    case "MERGED":
      return "MERGED — nothing left to do.";
    case "READY":
      return "READY — every check terminal+green, mergeable, zero unresolved threads.";
    case "FAILED":
      return `FAILED — ${result.failingChecks.join(", ")}: read the failing check's log and fix it.`;
    case "BLOCKED-ACTION":
      return `BLOCKED-ACTION — ${[...new Set(result.actions.map((a) => a.actor))].join(", ") || "PR author"} must act (below).`;
    case "WAITING":
      return `WAITING — ${result.waitingOn.length} check(s) still running (${formatEta(result.etaMs)}). `
        + "Not a failure: wait, or re-run with --wait.";
    default:
      return result.verdict;
  }
}

function report(state, result) {
  const { meta } = state;
  const { counts } = result;
  console.log(verdictHeadline(result));
  console.log(`PR #${meta.number}: ${meta.title}`);
  console.log(`  state=${meta.state} mergeable=${meta.mergeable} mergeStateStatus=${meta.mergeStateStatus}`);
  console.log(
    `  checks: ${counts.checksTotal} total — ${counts.failing} failing, ${counts.pending} pending; ` +
      `${counts.unresolvedThreads} unresolved review thread(s)`,
  );
  for (const n of result.notes) console.log(`  note: ${n}`);
  if (result.verdict === "BLOCKED-ACTION") {
    for (const a of result.actions) console.log(`   - [${a.actor}] ${a.text}`);
  } else if (result.blockers.length && result.verdict !== "MERGED") {
    for (const b of result.blockers) console.log(`   - ${b}`);
  }
  if (result.timedOut) console.log("  --wait timed out with checks still running; the verdict is still WAITING, not a failure.");
}

async function main() {
  let args;
  try {
    args = parsePrHealthArgs();
  } catch (e) {
    console.error(`pr-health: ${e.message}`);
    process.exit(PR_HEALTH_EXIT.UNREADABLE);
  }
  const durationCache = new Map();
  const read = () => {
    const state = fetchPrState(args.pr);
    const pendingWorkflows = state.checks.filter((c) => PENDING_BUCKETS.has(c.bucket)).map((c) => c.workflow);
    const typicalDurationsMs = pendingWorkflows.length ? fetchTypicalWorkflowDurations(pendingWorkflows, durationCache) : {};
    return { state, result: evaluatePrHealth({ ...state, typicalDurationsMs }) };
  };

  let last;
  try {
    if (args.wait) {
      const final = await waitForPrHealth({
        read: async () => {
          last = read();
          return last.result;
        },
        sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
        timeoutMs: args.timeoutMinutes * 60_000,
        intervalMs: args.intervalSeconds * 1000,
        onPoll: (result) => {
          if (result.verdict === "WAITING") console.error(`pr-health: ${verdictHeadline(result)}`);
        },
      });
      last = { ...last, result: final };
    } else {
      last = read();
    }
  } catch (e) {
    console.error(`pr-health: ${e.message}`);
    process.exit(PR_HEALTH_EXIT.UNREADABLE);
  }

  report(last.state, last.result);
  process.exit(last.result.exitCode);
}

if (isEntryModule(import.meta.url)) main();
