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
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { probeWorktreeReadiness } from "./lib/bootstrap-worktree-deps.mjs";
import { fetchOriginMainSharedSafe } from "./lib/git-fetch-shared-safe.mjs";
import { gitText } from "./lib/git.mjs";
import { scriptArgv } from "./lib/script-argv.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Run a command, inheriting stdio so gate output stays visible to the operator. */
function run(cmd, args, { capture = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
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
export function publish({ branch, base, title, body, dry, log, exec = run }) {
  // ── 7. push ───────────────────────────────────────────────────────────────
  log(`pushing ${branch}`);
  if (!dry) {
    const r = exec("git", ["push", "-u", "origin", branch], { allowFail: true });
    if (!r.ok) {
      return { step: "push",
        message: "push refused (pre-push gate or remote). It was NOT retried: a second push can "
          + "claim a new gate lease and overwrite a recorded PASS.",
        next: "read the output above, then `pnpm pregate:status` (read-only) — never re-push to re-read it" };
    }
  }

  // ── 8. pull request ───────────────────────────────────────────────────────
  const existing = exec("gh", ["pr", "view", "--json", "number", "-q", ".number"],
    { capture: true, allowFail: true });
  const prNumber = existing.ok ? existing.out.trim() : "";
  if (prNumber) {
    log(`PR #${prNumber} already open for this branch`);
  } else if (!title) {
    return { step: "pull-request", message: "--title is required to open a PR.",
      next: 'pass --title "type(scope): ..."' };
  } else {
    log("opening the PR");
    if (!dry) {
      const args = ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body];
      const r = exec("gh", args, { capture: true, allowFail: true });
      if (!r.ok) {
        return { step: "pull-request", message: `gh pr create failed.\n${r.out.slice(-800)}`,
          next: "read the output" };
      }
      log(r.out.trim());
    }
  }

  // ── 9. auto-merge, and VERIFY it took ─────────────────────────────────────
  if (!dry) {
    exec("gh", ["pr", "merge", "--squash", "--auto"], { capture: true, allowFail: true });
    const check = exec("gh", ["pr", "view", "--json", "autoMergeRequest", "-q",
      ".autoMergeRequest.mergeMethod"], { capture: true, allowFail: true });
    const method = check.out.trim();
    // Verified rather than assumed: `gh pr merge --auto` has reported success
    // while the PR never entered the queue. An unverified enable is a PR that
    // sits open looking finished.
    log(method ? `auto-merge enabled (${method})` : "! auto-merge did NOT take — enable it by hand");
  }
  return null;
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
      base: { type: "string", default: "main" },
    },
  });
  const dry = values["dry-run"];
  const log = (s) => process.stdout.write(`[land] ${s}\n`);

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
    log("done. The queue owns it from here; `pnpm pr:health` reports readiness.");
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

  log("done. The queue owns it from here; `pnpm pr:health` reports readiness.");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
