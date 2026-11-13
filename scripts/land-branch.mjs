#!/usr/bin/env node
// scripts/land-branch.mjs — the repetitive spine, as one command.
//
//   pnpm land --message-file msg.txt --title "feat(x): ..." --body-file body.md
//   pnpm land --message-file msg.txt --dry-run
//   (a `--` after `land` is tolerated: scripts/lib/script-argv.mjs)
//
// WHY THIS EXISTS, WITH RECEIPTS. Every piece of this already existed —
// gate:context (what CI will demand of this diff), the derived-artifacts
// registry (what to regenerate and the command to do it), gate:local (every
// deterministic gate against the working tree, reading the planned commit
// message), gate:wait (the queue/retry/classification policy as code),
// pr:health, merge-policy. Nothing chained them, so every agent rebuilt the
// chain by hand, in prose, once per branch.
//
// Measured on one session of nine PRs, by the agent that drove it:
//   - gate:context was run ZERO times, so required attestations and the
//     artifacts needing regeneration were discovered by hitting the refusal;
//   - gate:local was run zero times, so six commit -> refusal -> fix -> amend
//     cycles happened that it exists to collapse into one;
//   - gate:wait was run zero times, and roughly fifteen bash polling loops were
//     hand-written instead. Several were wrong in ways that matter: one treated
//     an INCONCLUSIVE queue state as a terminal verdict, one treated STALE as
//     non-terminal and spun for 39 minutes saying nothing, one grepped for a
//     failure pattern the test runner does not emit and reported a red suite as
//     green.
//
// gate-wait.mjs's own header already named this failure: "Callers used to write
// that policy in bash, once per session, and get it wrong... ceremony belongs in
// code, not in whoever is driving the gate." This applies the same reasoning one
// level up: the whole landing sequence is ceremony, and an agent re-deriving it
// each time spends context on it and gets it subtly wrong.
//
// WHAT IT WILL NOT DO. It never overrides a gate, never writes an attestation
// it was not given, and never converts an infrastructure outcome into a verdict
// about the diff — gate:wait owns that classification and this trusts it. A
// refusal here stops the sequence and prints the one next action.

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { probeWorktreeReadiness } from "./lib/bootstrap-worktree-deps.mjs";
import { fetchOriginMainSharedSafe } from "./lib/git-fetch-shared-safe.mjs";
import { gitText } from "./lib/git.mjs";
import { scriptArgv } from "./lib/script-argv.mjs";
import { repositorySlugFromRemote } from "./lib/documentation-evidence-lane.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Run a command, inheriting stdio so gate output stays visible to the operator. */
function run(cmd, args, { capture = false, allowFail = false, cwd = ROOT } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (!allowFail && r.status !== 0) {
    return { ok: false, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }
  return { ok: r.status === 0, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const git = (...args) => run("git", args, { capture: true, allowFail: true }).out.trim();

/** Steps are named so a failure says which one stopped, and what to do next. */
export const STEPS = [
  "preconditions",
  "sync",
  "context",
  "regenerate",
  "local-gates",
  "commit",
  "gate",
  "push",
  "pull-request",
  "auto-merge",
];

/**
 * Attestations that belong in the PR BODY rather than a commit trailer.
 *
 * The distinction is not cosmetic and it is easy to get wrong: the Seed
 * Contribution Fit gate reads the push-event body, so the same text in a commit
 * message does not satisfy it. gate:context knows which ones these are; this
 * reads that rather than hard-coding a list that would drift.
 */
export function bodyRequiredTrailers(context) {
  return (context.trailers ?? []).filter(
    (t) => t.level === "required" && /PR BODY/i.test(t.note ?? ""),
  );
}

/** @returns {string[]} trailers that gate:context requires but the body omits. */
export function missingBodyAttestations(context, body) {
  return bodyRequiredTrailers(context)
    .filter((t) => !body.includes(t.trailer))
    .map((t) => `${t.trailer} (${t.because})`);
}

/**
 * Parse gate:context's JSON and assert the floor this script relies on. A
 * shape that parses but lacks these fields is a contract change, not "no
 * obligations" — reading it as the latter is how a window passes for a whole.
 */
export function parseContext(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let context;
  try {
    context = JSON.parse(text.slice(start));
  } catch {
    return null;
  }
  const floor = Number.isInteger(context?.changedFileCount)
    && Array.isArray(context.trailers)
    && Array.isArray(context.derivedArtifacts);
  return floor ? context : null;
}

function readContext() {
  return parseContext(run("pnpm", ["-s", "gate:context", "--json"], { capture: true, allowFail: true }).out);
}

/**
 * What to do about base drift. `main` moves several commits an hour against a
 * single-slot gate queue, so a branch that was current when it was written is
 * usually behind by the time it lands; gating the stale tree only to have
 * pregate merge forward and find a stale derived artifact is the re-gate this
 * step removes. Merging (not rebasing) is deliberate: a merge never replays
 * history, so it is safe on a shallow clone where a bare rebase is not.
 *
 * @param {{ base: string, behind: number|null }} state  behind is null when unknowable
 * @returns {"current"|"merge"|"unknown"|"unsupported-base"}
 */
export function syncAction({ base, behind }) {
  if (base !== "main") return "unsupported-base";
  if (behind === null || !Number.isInteger(behind) || behind < 0) return "unknown";
  return behind === 0 ? "current" : "merge";
}

/** pregate:status --json, or null when the output is below its field floor. */
export function parseGateStatus(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    const status = JSON.parse(text.slice(start));
    return typeof status?.verdict === "string" && typeof status.headSha === "string" ? status : null;
  } catch {
    return null;
  }
}

/**
 * Where a failed gate:wait stopped. A record bound to an older SHA means
 * nothing was recorded for this one — the refusal came from preflight, which
 * claims no lease and writes no record, so pointing the reader at
 * pregate:status sends them to a stale verdict about different bytes.
 *
 * @returns {"preflight"|"verdict"|"unknown"}
 */
export function gateFailureSite(status, headSha) {
  if (!status || !headSha) return "unknown";
  return status.boundSha === headSha ? "verdict" : "preflight";
}

/**
 * Whether a PASS already recorded for HEAD can be landed as it stands.
 *
 * Merging origin/main forward is right BEFORE a gate, and wrong after one: it
 * mints a new SHA, the recorded PASS no longer binds to it, and another gate
 * run is queued — while GitHub's merge queue re-tests against current main
 * regardless. Observed on PR #6029 (2026-10-06): gate:wait hit its deadline
 * with the local-CI pool closed, the durable resumer later recorded PASS on
 * HEAD, and re-running land would have thrown that PASS away.
 *
 * A conflicting PR still merges forward: the queue cannot test what does not
 * merge. A dirty tree still gates: the PASS says nothing about uncommitted
 * bytes. A test-stub PASS is not evidence about the diff.
 *
 * @param {{ status: object|null, headSha: string, dirty: boolean, mergeable: string|null }} state
 *   status from parseGateStatus; mergeable from `gh pr view --json mergeable`, null with no PR
 * @returns {{ action: "land-recorded-pass"|"gate", reason: string }}
 */
export function recordedPassAction({ status, headSha, dirty, mergeable }) {
  if (!status || status.verdict !== "PASS") {
    return { action: "gate", reason: `no PASS recorded (${status?.verdict ?? "status unreadable"})` };
  }
  if (!headSha || status.boundSha !== headSha) {
    return { action: "gate", reason: `the recorded PASS is bound to ${status.boundSha || "no SHA"}, not HEAD` };
  }
  if (status.testStub === true) return { action: "gate", reason: "the recorded PASS is a test stub" };
  if (dirty) return { action: "gate", reason: "uncommitted changes are not covered by the recorded PASS" };
  if (mergeable === "CONFLICTING") {
    return { action: "gate", reason: "the PR conflicts with main, so it must merge forward and re-gate" };
  }
  return { action: "land-recorded-pass", reason: `PASS recorded for HEAD ${headSha.slice(0, 10)}` };
}

/**
 * Push, open (or find) the PR, enable auto-merge — shared by the gated path
 * and the recorded-PASS path.
 *
 * Pushes EXACTLY ONCE. The pre-push hook starts a gate run when it does not see
 * a PASS for the SHA, so re-running `git push`, even only to re-read a refusal,
 * can claim a rival lease and overwrite a recorded PASS (plan
 * 2026-10-02-agent-process-automation.md, item 9). On refusal, the hook's text
 * from that one attempt is what the operator gets.
 *
 * @returns {{ step: string, message: string, next?: string } | null} the refusal, or null when done
 */
const PR_FIELDS = "number,state,headRefName,baseRefName,headRefOid,isCrossRepository";
const PR_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number state headRefName baseRefName headRefOid autoMergeRequest{mergeMethod} mergeQueueEntry{id state position}}}}`;
const fullSha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const publicationRefusal = message => ({ step: "pull-request", message,
  next: "inspect the current PR and recorded evidence read-only; do not repeat push or queue requests" });
function jsonResult(result) {
  if (!result.ok) return null;
  try { return JSON.parse(result.out); } catch { return null; }
}
function currentOpenPr({ branch, base, repository, runner }) {
  // Explicit OPEN filtering excludes a historical MERGED/CLOSED branch PR.
  const rows = jsonResult(runner("gh", ["pr", "list", "--repo", `github.com/${repository}`,
    "--head", branch, "--base", base, "--state", "open", "--limit", "2", "--json", PR_FIELDS],
  { capture: true, allowFail: true }));
  if (!Array.isArray(rows) || rows.length > 1) return { refusal: publicationRefusal("Current OPEN PR is unreadable or ambiguous.") };
  const pr = rows[0] ?? null;
  if (pr && (!Number.isInteger(pr.number) || pr.number < 1 || pr.state !== "OPEN"
      || pr.headRefName !== branch || pr.baseRefName !== base || !fullSha(pr.headRefOid)
      || pr.isCrossRepository !== false)) return { refusal: publicationRefusal("PR does not match the current repository branch and base.") };
  return { pr };
}
function observePublication({ repository, prNumber, branch, base, headSha, runner }) {
  const [owner, name] = repository.split("/");
  const payload = jsonResult(runner("gh", ["api", "graphql", "--hostname", "github.com", "-f", `query=${PR_QUERY}`,
    "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${prNumber}`], { capture: true, allowFail: true }));
  const pr = payload?.data?.repository?.pullRequest;
  if (!payload || payload.errors?.length || !pr || pr.number !== prNumber
      || pr.headRefName !== branch || pr.baseRefName !== base || pr.headRefOid !== headSha) return "unknown";
  if (pr.state === "MERGED") return "merged";
  if (pr.state !== "OPEN" || !Object.hasOwn(pr, "mergeQueueEntry") || !Object.hasOwn(pr, "autoMergeRequest")) return "unknown";
  if (pr.mergeQueueEntry !== null) return typeof pr.mergeQueueEntry?.id === "string"
    && pr.mergeQueueEntry.id && typeof pr.mergeQueueEntry.state === "string" ? "queued" : "unknown";
  if (pr.autoMergeRequest !== null) return typeof pr.autoMergeRequest?.mergeMethod === "string"
    && pr.autoMergeRequest.mergeMethod ? "requested" : "unknown";
  return "unconfirmed";
}
function publishPushed({ branch, base, title, body, headSha, log, runner }) {
  const origin = runner("git", ["remote", "get-url", "origin"], { capture: true, allowFail: true });
  const repository = origin.ok ? repositorySlugFromRemote(origin.out) : "";
  if (!repository || !fullSha(headSha)) return publicationRefusal("Repository or exact pushed source could not be established.");
  let selection = currentOpenPr({ branch, base, repository, runner });
  if (selection.refusal) return selection.refusal;
  if (!selection.pr) {
    if (!title) return publicationRefusal("--title is required to create the current PR.");
    log("opening the current PR");
    const directory = mkdtempSync(join(tmpdir(), "dpf-land-body-"));
    try {
      const bodyFile = join(directory, "body.md");
      writeFileSync(bodyFile, body, { encoding: "utf8", mode: 0o600 });
      const created = runner("gh", ["pr", "create", "--repo", `github.com/${repository}`,
        "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile], { capture: true, allowFail: true });
      if (!created.ok) return publicationRefusal("Creating the current PR was refused; it was not retried.");
    } finally { rmSync(directory, { recursive: true, force: true }); }
    selection = currentOpenPr({ branch, base, repository, runner });
    if (selection.refusal) return selection.refusal;
  }
  const pr = selection.pr;
  if (!pr || pr.headRefOid !== headSha) return publicationRefusal("Current OPEN PR source is not confirmed as the exact pushed HEAD.");
  log(`current PR #${pr.number} matches ${headSha.slice(0, 10)}`);
  const binding = { repository, prNumber: pr.number, branch, base, headSha, runner };
  let state = observePublication(binding);
  if (state === "unknown") return publicationRefusal("Current PR publication state is unproven.");
  if (state === "unconfirmed") {
    const enabled = runner("gh", ["pr", "merge", String(pr.number), "--repo", `github.com/${repository}`,
      "--squash", "--auto", "--match-head-commit", headSha], { capture: true, allowFail: true });
    if (!enabled.ok) return { step: "auto-merge", message: "Queue request was refused; it was not retried.",
      next: `read pnpm pr:health ${pr.number}; do not repeat the request to discover its outcome` };
    state = observePublication(binding);
  }
  if (!["queued", "requested", "merged"].includes(state)) return { step: "auto-merge",
    message: "Queue request is not confirmed; no second request was made.", next: `read pnpm pr:health ${pr.number}` };
  log(state === "queued" ? `PR #${pr.number} is queued` : state === "merged"
    ? `PR #${pr.number} is merged` : `auto-merge requested for PR #${pr.number}; queue membership is not yet observed`);
  return null;
}

export function publish({ branch, base, title, body, dry, log, runner = run }) {
  if (dry) { log(`would push and publish ${branch}; no publication performed`); return null; }
  log(`pushing ${branch}`);
  const pushed = runner("git", ["push", "-u", "origin", branch], { allowFail: true });
  if (!pushed.ok) return { step: "push", message: "push refused; it was NOT retried because another push can overwrite a recorded PASS.",
    next: "read the original output and pnpm pregate:status; do not re-push to re-read a refusal" };
  const head = runner("git", ["rev-parse", "HEAD"], { capture: true, allowFail: true });
  return publishPushed({ branch, base, title, body, headSha: head.ok ? head.out.trim() : "", log, runner });
}

/** Resume only the post-push stages against unchanged, already-qualified bytes. */
export function resumePublished({ branch, base, title, body, headSha, expectedHeadSha, remoteHeadSha,
  dirty, status, context, dry, log, runner = run }) {
  if (!fullSha(expectedHeadSha) || headSha !== expectedHeadSha || remoteHeadSha !== expectedHeadSha
      || !branch || branch === "HEAD" || branch === base || dirty
      || status?.headSha !== headSha || status?.boundBranch !== branch || !status?.evidenceId
      || recordedPassAction({ status, headSha, dirty, mergeable: null }).action !== "land-recorded-pass") {
    return publicationRefusal("Resume requires a clean named branch, exact expected local/remote HEAD and a real current source-bound PASS.");
  }
  if (!context) return { step: "context", message: "Current gate context is unreadable; nothing published." };
  const missing = missingBodyAttestations(context, body);
  if (missing.length) return { step: "context", message: `Required PR-body attestations missing: ${missing.join(", ")}` };
  if (dry) { log("would resume post-push publication; no publication performed"); return null; }
  // This existing deterministic validator reads the stored receipt and current
  // policy. It records nothing, dispatches no review and preserves shadow/enforce.
  const semantic = runner(process.execPath, [resolve(ROOT, "scripts/semantic-review-gate.mjs"), "validate"],
    { capture: true, allowFail: true });
  if (!semantic.ok) return { step: "semantic-review", message: "Existing semantic publication policy refused this committed tree.",
    next: "inspect the existing receipt and its source binding; no new review or push was attempted" };
  if (semantic.out.trim()) log(semantic.out.trim());
  log(`resuming already-pushed ${branch}@${headSha.slice(0, 10)}; no push, merge-forward, gate or review replay`);
  return publishPushed({ branch, base, title, body, headSha, log, runner });
}

/** Read-only qualification uses the target cwd even when this helper is newer. */
export function resumeFromWorktree({ target, base, title, body, expectedHeadSha, dry, log,
  runner = run, readinessProbe = probeWorktreeReadiness }) {
  if (!fullSha(expectedHeadSha)) return publicationRefusal("--expected-head must identify the exact qualified commit.");
  const targetRun = (command, args, options = {}) => runner(command, args, { ...options, cwd: target });
  const readiness = readinessProbe(target);
  if (readiness.status !== "compile-ready") return publicationRefusal("Resume target is not compile-ready; nothing published.");
  const branchRead = targetRun("git", ["branch", "--show-current"], { capture: true, allowFail: true });
  const headRead = targetRun("git", ["rev-parse", "HEAD"], { capture: true, allowFail: true });
  const dirtyRead = targetRun("git", ["status", "--porcelain"], { capture: true, allowFail: true });
  if (![branchRead, headRead, dirtyRead].every(read => read.ok)) return publicationRefusal("Target Git identity or cleanliness is unreadable.");
  const branch = branchRead.out.trim();
  const headSha = headRead.out.trim();
  if (!branch || branch === "HEAD" || branch === base || headSha !== expectedHeadSha || dirtyRead.out.trim()) {
    return publicationRefusal("Target must remain a clean named topic branch at the exact expected HEAD.");
  }
  const remote = targetRun("git", ["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`], { capture: true, allowFail: true });
  const rows = remote.ok ? remote.out.trim().split("\n").filter(Boolean) : [];
  const fields = rows.length === 1 ? rows[0].split(/\s+/) : [];
  const remoteHeadSha = fields.length === 2 && fields[1] === `refs/heads/${branch}` ? fields[0] : null;
  if (remoteHeadSha !== expectedHeadSha) return publicationRefusal("Exact remote branch HEAD is unproven; nothing published.");
  const statusRead = targetRun("pnpm", ["-s", "pregate:status", "--json"], { capture: true, allowFail: true });
  const contextRead = targetRun("pnpm", ["-s", "gate:context", "--json"], { capture: true, allowFail: true });
  const status = statusRead.ok ? parseGateStatus(statusRead.out) : null;
  const context = contextRead.ok ? parseContext(contextRead.out) : null;
  return resumePublished({ branch, base, title, body, headSha, expectedHeadSha, remoteHeadSha,
    dirty: false, status, context, dry, log, runner: targetRun });
}

function readBody(file) {
  return file && existsSync(file) ? readFileSync(file, "utf8") : "";
}

function readGateStatus() {
  return parseGateStatus(run("pnpm", ["-s", "pregate:status", "--json"], { capture: true, allowFail: true }).out);
}

function fail(step, message, next) {
  process.stderr.write(`\n[land] STOPPED at ${step}\n\n  ${message}\n`);
  if (next) process.stderr.write(`\n  next: ${next}\n`);
  process.exitCode = 1;
}

function failMissingAttestations(missing) {
  return fail("context",
    "the PR BODY must carry these attestations, and this will not invent them:\n    - "
      + missing.join("\n    - "),
    "add them to your --body-file, then re-run pnpm land");
}

function main() {
  // Strict, no positionals: a mistyped flag refuses instead of being ignored.
  // scriptArgv drops the literal `--` pnpm forwards in `pnpm land -- --flag`.
  const { values } = parseArgs({
    args: scriptArgv(),
    options: {
      "message-file": { type: "string" },
      "body-file": { type: "string" },
      title: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "resume-publication": { type: "boolean", default: false },
      worktree: { type: "string" },
      "expected-head": { type: "string" },
      base: { type: "string", default: "main" },
    },
  });
  const dry = values["dry-run"];
  const log = (s) => process.stdout.write(`[land] ${s}\n`);

  if (values["resume-publication"] || values.worktree || values["expected-head"]) {
    if (!values["resume-publication"]) return fail("preconditions", "--worktree/--expected-head require --resume-publication.");
    const target = resolve(values.worktree ?? ROOT);
    const refusal = resumeFromWorktree({ target, base: values.base, title: values.title,
      body: readBody(values["body-file"]), expectedHeadSha: values["expected-head"], dry, log });
    if (refusal) return fail(refusal.step, refusal.message, refusal.next);
    log(dry ? "dry run done; no publication performed" : "publication observed; pnpm pr:health reports current checks and queue state");
    return;
  }

  // ── 1. preconditions ──────────────────────────────────────────────────────
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (!branch || branch === "HEAD") {
    return fail("preconditions", "detached HEAD — a landing needs a topic branch.",
      "git switch -c feat/<slug>");
  }
  if (branch === values.base) {
    return fail("preconditions", `on ${values.base} — work never lands FROM the base branch.`,
      "./scripts/new-dev-worktree.sh <slug>");
  }
  // Probe, do not read the marker: .dpf-worktree-readiness.json exists only
  // where seed-worktree-mcp ran, and an absent marker read as "fine" is a
  // window taken for the whole. An unprovisioned worktree env-skips its gates.
  const readiness = probeWorktreeReadiness(ROOT);
  if (readiness.status !== "compile-ready") {
    return fail("preconditions",
      `worktree is ${readiness.status} (${readiness.reason}); local gates would env-skip, not pass.`,
      "node scripts/lib/bootstrap-worktree-deps.mjs .");
  }
  log(`branch ${branch}, base ${values.base}`);

  // ── 1a. a PASS already recorded for HEAD is landed, not re-earned ─────────
  // Read before sync: merging forward would mint a new SHA and discard it.
  const headSha = git("rev-parse", "HEAD");
  const recorded = readGateStatus();
  const mergeable = recorded?.verdict === "PASS" && recorded.boundSha === headSha
    ? (run("gh", ["pr", "view", "--json", "mergeable", "-q", ".mergeable"],
      { capture: true, allowFail: true }).out.trim() || null)
    : null;
  const shortcut = recordedPassAction({
    status: recorded, headSha, dirty: git("status", "--porcelain").length > 0, mergeable,
  });
  if (shortcut.action === "land-recorded-pass") {
    log(`${shortcut.reason} — skipping merge-forward and gate:wait; the merge queue re-tests against main`);
    // Body attestations are read-only to check and cheap to get wrong, so they
    // are still refused here rather than after the push.
    const body = readBody(values["body-file"]);
    const context = readContext();
    if (!context) {
      return fail("context", "could not read `pnpm gate:context --json`.",
        "run it directly and fix the failure it reports");
    }
    const missing = missingBodyAttestations(context, body);
    if (missing.length > 0) return failMissingAttestations(missing);
    const refusal = publish({ branch, base: values.base, title: values.title, body, dry, log });
    if (refusal) return fail(refusal.step, refusal.message, refusal.next);
    log(dry ? "dry run done; no publication performed" : "publication observed; pnpm pr:health reports current checks and queue state");
    return;
  }
  if (recorded?.verdict === "PASS") log(`not landing the recorded PASS: ${shortcut.reason}`);

  // ── 1b. sync: merge the base forward before anything is derived from it ──
  let behind = null;
  if (values.base === "main") {
    try {
      fetchOriginMainSharedSafe((args) => gitText(args, { cwd: ROOT, trim: false }));
      const count = Number(git("rev-list", "--count", "HEAD..origin/main"));
      behind = Number.isInteger(count) ? count : null;
    } catch { behind = null; }
  }
  const action = syncAction({ base: values.base, behind });
  if (action === "unknown") {
    return fail("sync", "could not establish how far behind origin/main this branch is.",
      "git fetch origin main, then re-run");
  }
  if (action === "unsupported-base") log(`! base ${values.base}: drift is not checked for non-main bases`);
  if (action === "current") log("current with origin/main");
  if (action === "merge") {
    log(`${behind} commit(s) behind origin/main — merging forward`);
    if (!dry) {
      const r = run("git", ["merge", "--no-edit", "--signoff", "origin/main"], { capture: true, allowFail: true });
      if (!r.ok) {
        run("git", ["merge", "--abort"], { capture: true, allowFail: true });
        return fail("sync", `merging origin/main did not apply cleanly (aborted, tree unchanged).\n${r.out.slice(-800)}`,
          "commit or resolve, then re-run pnpm land");
      }
    }
  }

  // ── 2. context: what will CI demand of this diff ──────────────────────────
  const context = readContext();
  if (!context) {
    return fail("context", "could not read `pnpm gate:context --json`.",
      "run it directly and fix the failure it reports");
  }
  const derived = context.derivedArtifacts ?? [];
  log(`${context.changedFileCount} changed file(s); ${(context.trailers ?? []).length} attestation(s); `
    + `${derived.length} derived artifact group(s)`);

  // Body attestations are knowable now, so refuse now — not after a gate run
  // and a push have been spent on a branch whose PR would be refused.
  const body = readBody(values["body-file"]);
  const missing = missingBodyAttestations(context, body);
  if (missing.length > 0) return failMissingAttestations(missing);

  // ── 3. regenerate derived artifacts, from the commands the registry carries ─
  for (const d of derived) {
    if (!d.generate) {
      log(`! ${d.id}: no generate command recorded — regenerate it yourself`);
      continue;
    }
    log(`regenerating ${d.id}: ${d.generate.join(" ")}`);
    if (dry) continue;
    const r = run(d.generate[0], d.generate.slice(1), { capture: true, allowFail: true });
    if (!r.ok) {
      return fail("regenerate", `${d.id} failed to regenerate.\n${r.out.slice(-1200)}`,
        d.generate.join(" "));
    }
  }

  // ── 4. local gates, against the working tree and the PLANNED message ───────
  // The message is the one input this cannot derive, so a dirty tree without
  // one refuses here — before the gates are spent — not at the commit.
  const dirty = git("status", "--porcelain").length > 0;
  if (dirty && !values["message-file"]) {
    return fail("commit", "--message-file is required to commit: a generated message would be "
      + "the least useful part of the change.",
      'write the message, then: pnpm land --message-file msg.txt --title "..."');
  }
  const localArgs = ["gate:local"];
  if (values["message-file"]) localArgs.push("--message-file", values["message-file"]);
  else localArgs.push("--committed");
  log("running gate:local (every deterministic gate CI will run, pre-commit)");
  if (!dry) {
    const r = run("pnpm", localArgs, { allowFail: true });
    if (!r.ok) {
      return fail("local-gates",
        "a deterministic gate refused. These are the same gates CI runs — fixing them here is "
          + "what this step exists for, and overriding one is not an option.",
        "fix the findings above, then re-run pnpm land");
    }
  }

  // ── 5. commit ─────────────────────────────────────────────────────────────
  if (git("status", "--porcelain")) {
    log("committing (DCO-signed)");
    if (!dry) {
      run("git", ["add", "-A"], { capture: true, allowFail: true });
      const r = run("git", ["commit", "-s", "-F", values["message-file"]], { allowFail: true });
      if (!r.ok) return fail("commit", "git commit refused (see hook output above).", "fix, then re-run");
    }
  } else {
    log("nothing to commit — landing the existing HEAD");
  }

  // ── 6. the gate, with the retry/classification policy already written ─────
  log("running gate:wait (queue, retry and infra classification live in that script)");
  if (!dry) {
    const r = run("pnpm", ["gate:wait"], { allowFail: true });
    if (r.status === 7) {
      return fail("gate", "deadline elapsed without a verdict — NOTHING was established about the "
        + "diff. This is not a failure of the code.", "re-run pnpm land when the queue drains");
    }
    if (!r.ok) {
      const status = readGateStatus();
      const where = gateFailureSite(status, git("rev-parse", "HEAD"));
      if (where === "preflight") {
        return fail("gate", "a deterministic guard refused BEFORE a lease was claimed, so no gate "
          + "record exists for this SHA — the findings and their remedies are in the preflight "
          + "output above, not in pregate:status.", "fix them, then re-run pnpm land");
      }
      return fail("gate", where === "verdict"
        ? `the gate recorded ${status.verdict} for this SHA.`
        : "the gate failed and its status could not be read.",
        status?.logFile ? `read the full log: ${status.logFile}` : "pnpm pregate:status");
    }
  }

  // ── 7–9. push once, PR, auto-merge ────────────────────────────────────────
  const refusal = publish({ branch, base: values.base, title: values.title, body, dry, log });
  if (refusal) return fail(refusal.step, refusal.message, refusal.next);

  log(dry ? "dry run done; no publication performed" : "publication observed; pnpm pr:health reports current checks and queue state");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
