import { spawn } from "node:child_process";

// BI-D35B85BF. `gate-worktree.mjs` and `host-resource-runner.mjs` both exited 75
// on a queued claim, each believing the comment it carried: "the event/reconciler
// wakes this exact claimant, which then makes one fresh pressure-aware claim
// under the same identity". Nothing did. `applyNonprodCapacityEvent` writes a
// TaskRun projection and no process anywhere reads that projection back and
// re-invokes a gate. The durable wait had no consumer at all.
//
// Measured on one operator install over the 12h to 2026-09-10 04:55 UTC:
// the durable-wait path admitted 13 of 41 leases (32%, mean wait 1411s) while
// the in-process polling path admitted 11 of 11 (100%, mean wait 195s). Every
// durable-path admission traced to an AI session choosing to re-run pregate by
// hand — a platform guarantee resting on a client, which the commandment
// `platform-function-never-depends-on-a-client` forbids outright.
//
// This module is that missing consumer. It is deliberately NOT a daemon: one
// detached child per queued claim, which registers in the same local queue
// observer registry that already reaps dead waiters (local-queue-observer.mjs).
// A resumer that dies, leaks or outlives its gate is reaped by machinery that
// exists rather than by a new always-on service with its own failure modes.

/**
 * Set on every gate invocation the resumer itself makes. A gate that sees it
 * takes the same exit-75 path but does NOT spawn a second resumer — the one
 * already looping owns this claim. Without this, each queued re-claim would
 * fork another waiter and the queue would grow the very duplicate rows
 * BI-D35B85BF also reports.
 */
export const RESUME_MARKER_ENV = "DPF_DURABLE_RESUME";

/** Gap between re-claims. The lease's own admitted TTL is 120s, so a waiter
 *  that beats well inside that window always reads as live to
 *  `waiterProvesLiveness` and can never be skipped for staleness. */
export const DEFAULT_RESUME_INTERVAL_MS = 20_000;

/** Total time a resumer will keep re-claiming before giving up and releasing.
 *  Matches the queued row's own 2h wait deadline: outliving the row it exists
 *  to serve would leak a process for nothing. */
export const DEFAULT_RESUME_DEADLINE_MS = 2 * 60 * 60 * 1000;

/**
 * An explicit off-switch, for a caller that genuinely wants the bare exit.
 *
 * The gate's own integration tests assert the exit-75 CONTRACT; without this
 * they would each leave a real resumer re-claiming against a stub server long
 * after the test process is gone. The spawn contract itself is covered
 * separately, with an injected spawn, in durable-wait-resumer.test.mjs.
 */
export const RESUMER_DISABLE_ENV = "DPF_DURABLE_RESUMER";

/**
 * Is this process allowed to spawn a resumer, or is it already one?
 *
 * Exported separately from the spawn so callers can branch on it without
 * reaching into `process.env` themselves, and so the recursion guard is
 * testable in isolation - a broken guard forks unboundedly, which is the worst
 * failure this module could have.
 */
export function shouldSpawnResumer(env = process.env) {
  if (env[RESUMER_DISABLE_ENV] === "off") return false;
  return env[RESUME_MARKER_ENV] !== "1";
}

/** Why no resumer was spawned, so the gate can say so rather than stay silent. */
function noResumeReason(env) {
  return env[RESUMER_DISABLE_ENV] === "off" ? "disabled" : "already-resuming";
}

/**
 * The command line that re-runs THIS gate.
 *
 * `gateArgv` is the caller's own `process.argv` — the resumer replays the exact
 * invocation rather than reconstructing one from parsed options, so a flag the
 * gate grows tomorrow is carried without touching this file.
 */
export function buildResumerInvocation({
  runnerPath,
  gateArgv,
  observerDirectory,
  branch,
  sha,
  ownerSessionId,
  execPath = process.execPath,
  intervalMs = DEFAULT_RESUME_INTERVAL_MS,
  deadlineMs = DEFAULT_RESUME_DEADLINE_MS,
}) {
  if (!runnerPath) throw new Error("buildResumerInvocation requires runnerPath");
  if (!Array.isArray(gateArgv) || gateArgv.length < 2) {
    throw new Error("buildResumerInvocation requires the caller's full process.argv");
  }
  // The observer context travels as flags because the resumer must hold the
  // registry record for the WHOLE wait, not only while a re-claim is in flight.
  // Registering it only inside each gate run would leave the queued row
  // unbacked for the interval between runs, which is exactly the window the
  // reconciler reaps in.
  const observerFlags = observerDirectory
    ? [
      "--observer-dir", observerDirectory,
      "--branch", String(branch ?? ""),
      "--sha", String(sha ?? ""),
      "--owner-session-id", String(ownerSessionId ?? ""),
    ]
    : [];
  return {
    command: execPath,
    // argv[0] is the node binary the resumer supplies itself; argv[1] onward is
    // the gate script and its flags, replayed verbatim.
    args: [
      runnerPath,
      "--interval-ms", String(intervalMs),
      "--deadline-ms", String(deadlineMs),
      ...observerFlags,
      "--",
      ...gateArgv.slice(1),
    ],
  };
}

/**
 * Hand this claim to a detached resumer and return.
 *
 * The child is fully detached with no inherited stdio: the calling gate is
 * about to exit 75 and the session that launched it is about to be freed, so
 * anything holding a handle to either would keep the resumer bound to a
 * lifetime it must outlive.
 */
export function spawnDurableWaitResumer({
  runnerPath,
  gateArgv,
  observerDirectory,
  branch,
  sha,
  ownerSessionId,
  cwd,
  env = process.env,
  intervalMs = DEFAULT_RESUME_INTERVAL_MS,
  deadlineMs = DEFAULT_RESUME_DEADLINE_MS,
  spawnFn = spawn,
}) {
  if (!shouldSpawnResumer(env)) {
    return { spawned: false, reason: noResumeReason(env), pid: null };
  }
  const { command, args } = buildResumerInvocation({
    runnerPath,
    gateArgv,
    observerDirectory,
    branch,
    sha,
    ownerSessionId,
    execPath: env.DPF_RESUMER_NODE || process.execPath,
    intervalMs,
    deadlineMs,
  });
  try {
    const child = spawnFn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      env: { ...env, [RESUME_MARKER_ENV]: "1" },
    });
    // Without unref the parent's event loop stays alive for the child and the
    // gate never actually exits 75.
    if (typeof child?.unref === "function") child.unref();
    return { spawned: true, reason: null, pid: child?.pid ?? null };
  } catch (error) {
    // A resumer that cannot start must never take the gate down with it: the
    // claim is already queued and a human or a later re-run can still drive it.
    // Report it as unspawned so the caller can say so in its own output.
    return { spawned: false, reason: `spawn-failed: ${error?.message || error}`, pid: null };
  }
}
