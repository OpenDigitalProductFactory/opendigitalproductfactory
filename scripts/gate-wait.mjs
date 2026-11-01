#!/usr/bin/env node
// scripts/gate-wait.mjs — BI-22E11EA2
//
//   pnpm gate:wait                     # run pregate, waiting out infrastructure
//   pnpm gate:wait -- --deadline 45    # minutes (default 60)
//   pnpm gate:wait -- --json           # one JSON line per attempt
//
// Observe one governed attempt. A queued claim has a durable resumer; this
// wrapper never creates another claim because a local watch window elapsed.
// Terminal or unreadable state stops without a verdict. Reconciliation and an
// explicitly new attempt belong to the canonical recovery path.
//
// EXIT CODES
//   0  gate passed (or passed with evidence pending — see the printed next step)
//   1  the gate genuinely failed, or is blocked on something a retry cannot fix
//   7  launch failed or deadline elapsed without a verdict (ABANDONED_OR_UNRECORDED)
//      — deliberately NOT 0 and NOT 1: nothing was established about the diff.

import { parseArgs as utilParseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { classifyGateExit, GATE_EXIT } from "./lib/gate-exit-classification.mjs";
import { PREGATE_VERDICTS } from "./lib/pregate-status.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { scriptArgv } from "./lib/script-argv.mjs";
import { resolveHostCommandInvocation } from "./lib/host-command-invocation.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = Object.freeze({
  deadlineMinutes: 60,
  firstDelaySeconds: 20,
  maxDelaySeconds: 60,
});

/** Backoff that ramps gently and then holds — the queue moves on its own clock. */
export function delayForAttempt(attempt, { firstDelaySeconds, maxDelaySeconds } = DEFAULTS) {
  return Math.min(maxDelaySeconds, firstDelaySeconds + (attempt - 1) * 10);
}

/** Observe the existing durable attempt; at most one new claim per invocation. */
export function parseGateStatus(output) {
  try {
    const result = JSON.parse(String(output));
    return result && PREGATE_VERDICTS.includes(result.verdict) ? result : null;
  } catch { return null; }
}

export async function waitForGate({
  runGate,
  readStatus,
  sleep,
  now = () => Date.now(),
  log = () => {},
  deadlineMinutes = DEFAULTS.deadlineMinutes,
  firstDelaySeconds = DEFAULTS.firstDelaySeconds,
  maxDelaySeconds = DEFAULTS.maxDelaySeconds,
} = {}) {
  const startedAt = now();
  const deadlineAt = startedAt + deadlineMinutes * 60_000;
  const attempts = [];
  let watching = false;
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

    const currentClaim = status?.boundSha && status.boundSha === status.headSha;
    const active = currentClaim && ["queued", "admitted", "running"].includes(status.gateStatus);
    if (active) watching = true;
    if (!status || status.verdict === "PENDING" || (currentClaim && status.gateStatus && !active)
        || (status.verdict === "INCONCLUSIVE" && !active)) {
      return { outcome: "inconclusive", exitCode: GATE_EXIT.ABANDONED_OR_UNRECORDED,
        verdict: { kind: "did-not-run", verdict: "none", summary: "No current publishable verdict; observation stops without another claim.",
          next: "Read the recorded task, reconcile terminal or unreadable state, and resume durably. Start a new attempt only after reconciliation." }, attempts };
    }
    if (watching) {
      log({ cycle, elapsedMs: now() - startedAt, kind: "watching", summary: "observing the existing durable attempt; no new claim", code: null });
    } else {
      const { code, launchError } = await runGate();
      let verdict = classifyGateExit({ code });
      if (verdict.kind === "spawn-failed" && launchError) {
        verdict = { ...verdict, summary: `${verdict.summary}; ${launchError}` };
      }
      // An inconclusive record distinguishes infrastructure from a failing
      // diff; it never authorizes another claim.
      if (verdict.kind === "failed") {
        const after = await readStatus();
        if (after?.verdict === "INCONCLUSIVE") {
          verdict = {
            kind: "infrastructure", retry: true, verdict: "none",
            summary: `exit ${code}, but the record says INCONCLUSIVE — not a verdict about the diff`,
          };
        }
      }
      lastVerdict = verdict;
      attempts.push({ attempt: attempts.length + 1, code, kind: verdict.kind, elapsedMs: now() - startedAt });
      log({ cycle, elapsedMs: now() - startedAt, ...verdict, code });
      if (!verdict.retry) {
        if (verdict.kind === "spawn-failed") return { outcome: "inconclusive", exitCode: GATE_EXIT.ABANDONED_OR_UNRECORDED, verdict, attempts };
        if (verdict.verdict === "pass") return { outcome: "passed", exitCode: 0, verdict, attempts };
        return { outcome: "failed", exitCode: 1, verdict, attempts };
      }
      if (verdict.kind === "queued") watching = true;
      else return { outcome: "inconclusive", exitCode: GATE_EXIT.ABANDONED_OR_UNRECORDED,
        verdict: { ...verdict, next: "Reconcile this attempt before explicitly requesting another gate." }, attempts };
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
  const { values } = utilParseArgs({
    args: scriptArgv(argv),
    options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" }, deadline: { type: "string" } },
  });
  if (values.deadline === "") throw new Error("Unknown or incomplete argument: --deadline");
  const options = {};
  if (values.help) options.help = true;
  if (values.json) options.json = true;
  if (values.deadline !== undefined) options.deadlineMinutes = Number(values.deadline);
  return options;
}

/** Resolve the installed package manager through the shared shell-free host adapter. */
export function pregateSpawnOptions({
  platform = process.platform,
  env = process.env,
  cwd = REPO_ROOT,
} = {}) {
  return {
    ...resolveHostCommandInvocation("pnpm", ["run", "pregate"], { platform, env }),
    options: {
      cwd,
      stdio: "inherit",
      shell: false,
      // gate:wait is the sanctioned capture. Pregate must not treat it as a wrapped invocation.
      env: { ...env, DPF_PREGATE_ALLOW_CAPTURE: "1" },
    },
  };
}

/** A command that never launched is an unrun gate, including resolution errors. */
export function runPregate({ spawnSyncImpl = spawnSync, ...options } = {}) {
  const failed = error => ({
    code: null,
    launchError: String(error?.message ?? error ?? "Unknown process launch error").replace(/[\r\n\t]/g, " ").slice(0, 500),
  });
  try {
    const spec = pregateSpawnOptions(options);
    const run = spawnSyncImpl(spec.command, spec.args, spec.options);
    return run.error ? failed(run.error) : { code: run.status };
  } catch (error) {
    return failed(error);
  }
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
      "  Observes one durable gate request; queued requests are never re-claimed.\n" +
      "  Terminal or unreadable state stops for canonical reconciliation.\n" +
      "  Exit 0 = passed, 1 = genuinely failed or blocked, 7 = launch failure or deadline with no verdict.\n",
    );
    return 0;
  }

  const result = await waitForGate({
    deadlineMinutes: options.deadlineMinutes ?? DEFAULTS.deadlineMinutes,
    // Foreground and UNPIPED — the runbook lists redirecting pregate's output as
    // the most common way to lose a run, so the console goes straight through.
    runGate: () => runPregate(),
    readStatus: () => {
      const run = spawnSync(process.execPath, [resolve(REPO_ROOT, "scripts/pregate-status.mjs"), "--json"], { cwd: REPO_ROOT, encoding: "utf8" });
      return parseGateStatus(run.stdout);
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
