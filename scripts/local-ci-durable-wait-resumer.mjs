#!/usr/bin/env node
import { spawn } from "node:child_process";

import {
  DEFAULT_RESUME_DEADLINE_MS,
  DEFAULT_RESUME_INTERVAL_MS,
  RESUME_MARKER_ENV,
} from "./lib/durable-wait-resumer.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
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

const EXIT_QUEUED = 75;

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

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

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
}) {
  const giveUpAt = now() + deadlineMs;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const code = await runGateOnce({ gateArgv, env, spawnFn });
    if (code !== EXIT_QUEUED && code !== null) return { code, attempts };
    if (now() >= giveUpAt) return { code: EXIT_QUEUED, attempts };
    await sleepFn(intervalMs);
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

  try {
    const { code } = await resumeUntilAdmitted({
      gateArgv: options.gateArgv,
      intervalMs: options.intervalMs,
      deadlineMs: options.deadlineMs,
    });
    process.exitCode = code ?? EXIT_QUEUED;
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
