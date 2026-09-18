#!/usr/bin/env node
// scripts/gate-wait.mjs — BI-22E11EA2
//
//   pnpm gate:wait                     # run pregate, waiting out infrastructure
//   pnpm gate:wait -- --deadline 45    # minutes (default 60)
//   pnpm gate:wait -- --json           # one JSON line per attempt
//
// WHY THIS EXISTS. `pregate` reaches a verdict only when it gets a slot. Until
// then it exits 75 (queued), 5 (fenced/starved), 87 (child killed), 7 (window
// elapsed), or occasionally 1 carrying lease-lost text. AGENTS.md §4: those are
// inconclusive and re-run on the same SHA — never a FAIL against the diff.
//
// Callers used to write that policy in bash, once per session, and get it
// wrong. The classification lives in lib/gate-exit-classification.mjs; this is
// the loop around it. There is no judgment here, which is the point: ceremony
// belongs in code, not in whoever is driving the gate.
//
// EXIT CODES
//   0  gate passed (or passed with evidence pending — see the printed next step)
//   1  the gate genuinely failed, or is blocked on something a retry cannot fix
//   7  deadline elapsed without ever reaching a verdict (ABANDONED_OR_UNRECORDED)
//      — deliberately NOT 0 and NOT 1: nothing was established about the diff.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { classifyGateExit, GATE_EXIT } from "./lib/gate-exit-classification.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = Object.freeze({
  deadlineMinutes: 60,
  firstDelaySeconds: 20,
  maxDelaySeconds: 60,
  // After a queue, watch the status this many cycles before claiming again.
  watchCyclesAfterQueue: 3,
});

/** Backoff that ramps gently and then holds — the queue moves on its own clock. */
export function delayForAttempt(attempt, { firstDelaySeconds, maxDelaySeconds } = DEFAULTS) {
  return Math.min(maxDelaySeconds, firstDelaySeconds + (attempt - 1) * 10);
}

/**
 * The loop. Every side effect is injected so tests drive it without spawning a
 * gate or sleeping.
 *
 * THE ORDER MATTERS, and it is not the obvious one. The build-gate runbook is
 * explicit that "invoke pregate, then read pregate:status" is UNSAFE: once the
 * gate passes, another invocation claims a fresh lease, runs the identical tree
 * again, and THAT verdict supersedes the pass — which is how a genuine PASS
 * became a `failed` record in BI-1669E08A. So:
 *
 *   1. Read the status FIRST. A PASS bound to this HEAD means done; never
 *      invoke the gate again to "confirm" it.
 *   2. Only invoke pregate when no verdict exists.
 *   3. After a queued (75) exit the claim is handed to a detached resumer, and
 *      the runbook's instruction is to STOP polling the gate and read the status
 *      later. So a queue puts this loop into a status-watching phase rather than
 *      a gate-invoking one. It re-invokes only after the watch window elapses
 *      with still no verdict — which covers the `resumeOwner: "caller"` case,
 *      where the queued row dies if no local process re-claims it.
 *
 * pregate is spawned with inherited stdio on purpose: the same runbook lists
 * redirecting or piping its output as the most common way to lose a run. That
 * is also why classification never reads its console text — `pregate:status` is
 * the verdict, the console is not.
 */
export async function waitForGate({
  runGate,
  readStatus,
  sleep,
  now = () => Date.now(),
  log = () => {},
  deadlineMinutes = DEFAULTS.deadlineMinutes,
  firstDelaySeconds = DEFAULTS.firstDelaySeconds,
  maxDelaySeconds = DEFAULTS.maxDelaySeconds,
  watchCyclesAfterQueue = DEFAULTS.watchCyclesAfterQueue,
} = {}) {
  const startedAt = now();
  const deadlineAt = startedAt + deadlineMinutes * 60_000;
  const attempts = [];
  let watchRemaining = 0;
  let lastVerdict = null;

  for (let cycle = 1; ; cycle++) {
    const status = await readStatus();
    if (status?.verdict === "PASS") {
      log({ cycle, elapsedMs: now() - startedAt, kind: "pass", summary: "PASS recorded for this HEAD", code: 0 });
      return { outcome: "passed", exitCode: 0, verdict: { kind: "pass", verdict: "pass", summary: "gate passed" }, attempts };
    }
    if (status?.verdict === "FAIL") {
      log({ cycle, elapsedMs: now() - startedAt, kind: "failed", summary: "FAIL recorded for this HEAD", code: 1 });
      return { outcome: "failed", exitCode: 1, verdict: { kind: "failed", verdict: "fail", summary: "gate failed — read it with pnpm run pregate:status" }, attempts };
    }

    // No verdict. Either watch the resumer work, or claim a run ourselves.
    if (watchRemaining > 0) {
      watchRemaining--;
      log({ cycle, elapsedMs: now() - startedAt, kind: "watching", summary: `no verdict yet; a resumer holds the claim (${watchRemaining} watch cycle(s) left)`, code: null });
    } else {
      const { code } = await runGate();
      const verdict = classifyGateExit({ code });
      lastVerdict = verdict;
      attempts.push({ attempt: attempts.length + 1, code, kind: verdict.kind, elapsedMs: now() - startedAt });
      log({ cycle, elapsedMs: now() - startedAt, ...verdict, code });
      if (!verdict.retry) {
        if (verdict.verdict === "pass") return { outcome: "passed", exitCode: 0, verdict, attempts };
        return { outcome: "failed", exitCode: 1, verdict, attempts };
      }
      if (verdict.kind === "queued") watchRemaining = watchCyclesAfterQueue;
    }

    const delayMs = delayForAttempt(cycle, { firstDelaySeconds, maxDelaySeconds }) * 1000;
    if (now() + delayMs >= deadlineAt) {
      return {
        outcome: "deadline",
        exitCode: GATE_EXIT.ABANDONED_OR_UNRECORDED,
        verdict: lastVerdict ?? { kind: "did-not-run", verdict: "none", summary: "no verdict was ever recorded" },
        attempts,
      };
    }
    await sleep(delayMs);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") options.help = true;
    else if (argv[i] === "--json") options.json = true;
    else if (argv[i] === "--deadline" && argv[i + 1]) options.deadlineMinutes = Number(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  if (options.help) {
    process.stdout.write(
      "pnpm gate:wait [-- --deadline <minutes>] [--json]\n" +
      "  Runs pregate, waiting out infrastructure (queued lease, fenced run, killed child)\n" +
      "  and surfacing a real gate failure immediately.\n" +
      "  Exit 0 = passed, 1 = genuinely failed or blocked, 7 = deadline with no verdict.\n",
    );
    return 0;
  }

  const result = await waitForGate({
    deadlineMinutes: options.deadlineMinutes ?? DEFAULTS.deadlineMinutes,
    // Foreground and UNPIPED — the runbook lists redirecting pregate's output as
    // the most common way to lose a run, so the console goes straight through.
    runGate: () => {
      const run = spawnSync("pnpm", ["run", "pregate"], { cwd: REPO_ROOT, stdio: "inherit" });
      return { code: run.status };
    },
    readStatus: () => {
      const run = spawnSync("pnpm", ["run", "pregate:status", "--", "--json"], { cwd: REPO_ROOT, encoding: "utf8" });
      try {
        const line = (run.stdout ?? "").split("\n").find((l) => l.trim().startsWith("{"));
        return line ? JSON.parse(line) : null;
      } catch {
        return null; // unreadable status is "no verdict", never a pass
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (entry) => {
      if (options.json) {
        process.stdout.write(`${JSON.stringify(entry)}\n`);
        return;
      }
      const mins = Math.round(entry.elapsedMs / 60_000);
      process.stdout.write(
        `gate:wait cycle ${entry.cycle} (${mins}m elapsed) — ${entry.kind}: ${entry.summary}\n`,
      );
    },
  });

  if (result.outcome === "deadline") {
    process.stderr.write(
      `gate:wait: deadline elapsed after ${result.attempts.length} attempt(s) without reaching a verdict — ` +
        `exiting ${GATE_EXIT.ABANDONED_OR_UNRECORDED}, not 0. Nothing was established about this diff; ` +
        `the gate never ran to completion.\n`,
    );
    return result.exitCode;
  }
  if (result.verdict.next) process.stdout.write(`gate:wait: next step — ${result.verdict.next}\n`);
  if (result.outcome === "failed") {
    process.stderr.write(`gate:wait: ${result.verdict.summary}\n`);
    process.stderr.write("gate:wait: read the verdict with `pnpm run pregate:status` — the console text is not it.\n");
  }
  return result.exitCode;
}

if (isEntryModule(import.meta.url)) process.exitCode = await main();
