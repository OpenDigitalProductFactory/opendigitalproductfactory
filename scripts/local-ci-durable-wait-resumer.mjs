#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_RESUME_DEADLINE_MS,
  DEFAULT_RESUME_INTERVAL_MS,
  RESUME_MARKER_ENV,
} from "./lib/durable-wait-resumer.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import {
  EXIT_CHILD_SIGNAL_DEATH,
  EXIT_CONTROL_PLANE_STARVATION,
} from "./lib/sandbox-freshness.mjs";
import {
  createGateObserverIdentity,
  registerLocalQueueObserver,
  releaseLocalQueueObserver,
} from "./lib/local-queue-observer.mjs";

// BI-D35B85BF. The consumer the durable wait never had. Spawned detached by a
// gate that has just queued and is about to exit 75, this process does the one
// thing the platform was assuming an AI session would do: keep re-claiming
// until the lease is admitted, then let the gate run to completion.
//
// It writes no verdict of its own. The gate it re-invokes writes its own state
// file exactly as it does on a first run, so `pregate:status` remains the
// single source of the verdict and this file adds no second home for one.

export const EXIT_QUEUED = 75;

/**
 * Exit codes that are NOT a verdict, so the resumer keeps waiting.
 *
 * AGENTS.md 4: "A gate that could not run is not a verdict. Infrastructure
 * failure is recorded as inconclusive and re-runs on the same SHA. Never a FAIL
 * against the diff. Fail closed on safety; fail open on infrastructure."
 *
 * The first build of this resumer returned on ANY code other than 75, so a
 * control-plane starvation (exit 5) - a transient condition this host produces
 * regularly under concurrent gate load - ended the wait as though the gate had
 * answered. Observed live 2026-09-12: attempt 7 returned 5, the resumer wrote
 * "finished", and the branch was left carrying a phantom FAIL with no recorded
 * reason that exact-tree reuse then replayed (BI-ED53E13A).
 *
 * `classifyGateOutcome` in lib/sandbox-freshness.mjs is the single source of
 * truth for what each code means; this set is the subset it classifies as
 * blocked AND transient, and a test asserts the two never drift apart.
 *
 * Deliberately NOT here: EXIT_SANDBOX_DRIFT (3). It is equally "not a verdict",
 * but re-running cannot converge a drifted sandbox, so retrying it would spin
 * until the deadline instead of surfacing the real work.
 */
export const RETRYABLE_EXITS = Object.freeze([
  EXIT_QUEUED,
  EXIT_CONTROL_PLANE_STARVATION,
  EXIT_CHILD_SIGNAL_DEATH,
  130, // 128 + SIGINT, stamped when the parent took the signal (BI-8392DA16)
  143, // 128 + SIGTERM, likewise
]);

/** A host that just starved will starve again in 20s; back off before retrying. */
export const INFRASTRUCTURE_BACKOFF_MS = 60_000;

export function isRetryableExit(code) {
  return RETRYABLE_EXITS.includes(code);
}

// A detached process with stdio "ignore" that leaves no trace is undiagnosable:
// when the first field build of this resumer died on its second re-claim there
// was nothing at all to read. The log lives beside the observer record so the
// same reap that clears one clears the other.
function makeLogger(directory, token) {
  if (!directory) return () => {};
  const path = join(directory, `${token}.resumer.log`);
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    return () => {};
  }
  return (event, detail = {}) => {
    try {
      appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), event, ...detail })}
`);
    } catch { /* logging must never take the resumer down */ }
  };
}

export function parseResumerArgs(argv) {
  const options = {
    intervalMs: DEFAULT_RESUME_INTERVAL_MS,
    deadlineMs: DEFAULT_RESUME_DEADLINE_MS,
    observerDirectory: "",
    branch: "",
    sha: "",
    ownerSessionId: "",
    gateArgv: [],
  };
  const separator = argv.indexOf("--");
  const flags = separator === -1 ? argv : argv.slice(0, separator);
  options.gateArgv = separator === -1 ? [] : argv.slice(separator + 1);
  for (let index = 0; index < flags.length; index += 2) {
    const value = flags[index + 1];
    switch (flags[index]) {
      case "--interval-ms": options.intervalMs = Number(value); break;
      case "--deadline-ms": options.deadlineMs = Number(value); break;
      case "--observer-dir": options.observerDirectory = value; break;
      case "--branch": options.branch = value; break;
      case "--sha": options.sha = value; break;
      case "--owner-session-id": options.ownerSessionId = value; break;
      default: break;
    }
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    options.intervalMs = DEFAULT_RESUME_INTERVAL_MS;
  }
  if (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0) {
    options.deadlineMs = DEFAULT_RESUME_DEADLINE_MS;
  }
  return options;
}

// NOT unref'd, deliberately. An unref'd timer does not hold the event loop
// open, and between re-claims this process has nothing else referenced - the
// gate child has exited and stdio is "ignore". The first field build unref'd
// here and every resumer died silently mid-sleep with exit 0, after exactly one
// re-claim, which looked identical to the defect it was written to fix.
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function runGateOnce({ gateArgv, env, spawnFn }) {
  return new Promise((resolve) => {
    const child = spawnFn(process.execPath, gateArgv, {
      stdio: "ignore",
      env: { ...env, [RESUME_MARKER_ENV]: "1" },
    });
    child.once("error", () => resolve(null));
    child.once("exit", (code) => resolve(code));
  });
}

/**
 * Re-claim until the gate stops saying "queued".
 *
 * Returns the gate's final exit code, or 75 if the deadline passed while still
 * queued. A spawn error resolves as `null` and is retried rather than treated
 * as a verdict: `report-only-the-verdict-you-reached` — an infrastructure
 * failure to launch is not a FAIL against the diff.
 */
export async function resumeUntilAdmitted({
  gateArgv,
  intervalMs,
  deadlineMs,
  env = process.env,
  now = () => Date.now(),
  spawnFn = spawn,
  sleepFn = sleep,
  log = () => {},
}) {
  const giveUpAt = now() + deadlineMs;
  let attempts = 0;
  let blockedAttempts = 0;
  for (;;) {
    attempts += 1;
    const code = await runGateOnce({ gateArgv, env, spawnFn });
    const blocked = code !== null && code !== EXIT_QUEUED && isRetryableExit(code);
    if (blocked) blockedAttempts += 1;
    log("gate-attempt", { attempts, code, ...(blocked ? { blocked: true } : {}) });
    // A real verdict - the gate passed or the product failed - ends the wait.
    // Anything the classifier calls blocked-and-transient does not.
    if (code !== null && !isRetryableExit(code)) return { code, attempts, blockedAttempts };
    if (now() >= giveUpAt) return { code: EXIT_QUEUED, attempts, blockedAttempts };
    await sleepFn(blocked ? Math.max(intervalMs, INFRASTRUCTURE_BACKOFF_MS) : intervalMs);
  }
}

async function main() {
  const options = parseResumerArgs(process.argv.slice(2));
  if (options.gateArgv.length === 0) {
    process.stderr.write("local-ci-durable-wait-resumer: no gate invocation supplied after --\n");
    process.exit(64);
  }

  // Hold a registry record for the WHOLE wait. Between re-claims there is no
  // gate process, and without this the queued row would look unbacked to the
  // reconciler and be reaped mid-wait.
  let observerPath = "";
  const identity = createGateObserverIdentity();
  if (options.observerDirectory) {
    try {
      observerPath = registerLocalQueueObserver({
        directory: options.observerDirectory,
        identity,
        ownerSessionId: options.ownerSessionId || identity.ownerSessionId,
        branch: options.branch,
        sha: options.sha,
      }).path;
    } catch {
      // An unwritable registry must not stop the resume; the claim is already
      // queued and re-claiming still advances its heartbeat.
      observerPath = "";
    }
  }

  const log = makeLogger(options.observerDirectory, identity.token);
  log("start", { pid: process.pid, gateArgv: options.gateArgv, intervalMs: options.intervalMs });
  try {
    const { code, attempts, blockedAttempts } = await resumeUntilAdmitted({
      gateArgv: options.gateArgv,
      intervalMs: options.intervalMs,
      deadlineMs: options.deadlineMs,
      log,
    });
    log("finished", { code, attempts, blockedAttempts });
    process.exitCode = code ?? EXIT_QUEUED;
  } catch (error) {
    log("crashed", { message: String(error?.message || error) });
    throw error;
  } finally {
    if (observerPath) {
      try {
        releaseLocalQueueObserver({ path: observerPath, token: identity.token });
      } catch { /* the TTL reap in local-queue-observer.mjs is the backstop */ }
    }
  }
}

if (isEntryModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`local-ci-durable-wait-resumer: ${error?.stack || error}\n`);
    process.exit(70);
  });
}
