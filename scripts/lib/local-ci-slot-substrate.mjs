// BI-277ECBDB (A): check the slot substrate BEFORE claiming a lease.
//
// The local-CI gate needs each slot's PostgreSQL container
// (dpf-local-ci-postgres-<N>), and it used to discover a dead one only after a
// slot was granted. The queue then filled with claims that could not run, and
// "queued" read the same whether five sessions were ahead or the database was
// gone. The gate now probes every slot's container first and starts a stopped
// one itself (the same ensure-start the runner does). It refuses to claim only
// when NO slot's substrate can run, and it says which container and why.
//
// A container that does not exist yet is available: the runner provisions it on
// admission. Only a container Docker cannot run is a block.

import { spawnSync } from "node:child_process";

/**
 * The gate status written when no slot's PostgreSQL container can run. Re-running
 * cannot help until the substrate is back, so `pregate:status` shows its remedy
 * instead of the re-run advice every other non-PASS verdict gets.
 */
export const SLOT_SUBSTRATE_UNAVAILABLE_STATUS = "blocked_slot_substrate_unavailable";

const INSPECT_FORMAT = "{{.State.Status}}|{{.State.ExitCode}}";

function defaultRun(command, args) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 30_000 });
}

function inspect(container, run) {
  const result = run("docker", ["inspect", "--format", INSPECT_FORMAT, container]);
  if (result.status !== 0) {
    return /no such (object|container)/i.test(`${result.stderr || ""}${result.stdout || ""}`)
      ? { status: "absent" }
      : { status: "unreadable", error: (result.stderr || result.stdout || "").trim() };
  }
  const [status, exitCode] = String(result.stdout || "").trim().split("|");
  return { status: status || "unknown", exitCode: Number(exitCode) };
}

function describe(observed) {
  if (observed.status === "exited" && Number.isFinite(observed.exitCode)) {
    return `exited (${observed.exitCode})`;
  }
  return observed.status;
}

export function slotSubstrateRemedy(container, error = "") {
  return `the gate already tried \`docker start ${container}\` and Docker refused`
    + (error ? `: ${error}` : "")
    + ". Fix what Docker reports (port conflict, volume, engine health); gating again changes nothing until the container runs.";
}

/**
 * Probe one slot's PostgreSQL container and start it when it is stopped.
 * @returns {{ container: string, state: string, available: boolean, started: boolean, error?: string }}
 */
export function ensureSlotPostgres(container, { run = defaultRun } = {}) {
  const observed = inspect(container, run);
  if (observed.status === "running") {
    return { container, state: "running", available: true, started: false };
  }
  if (observed.status === "absent") {
    return { container, state: "absent", available: true, started: false };
  }
  if (observed.status === "unreadable") {
    return { container, state: "unreadable", available: false, started: false, error: observed.error };
  }
  const start = run("docker", ["start", container]);
  if (start.status === 0) {
    const after = inspect(container, run);
    if (after.status === "running") {
      return { container, state: "running", available: true, started: true };
    }
    return { container, state: describe(after), available: false, started: true, error: "it stopped again right after starting" };
  }
  return {
    container,
    state: describe(observed),
    available: false,
    started: false,
    error: (start.stderr || start.stdout || "").trim(),
  };
}

/**
 * The pool can admit someone while at least one slot's substrate can run.
 * When none can, name the first unavailable container and its remedy.
 */
export function assessSlotSubstrate(probes) {
  if (probes.some((probe) => probe.available)) {
    return { blocked: false, probes };
  }
  const first = probes[0] ?? { container: "dpf-local-ci-postgres-0", state: "unknown" };
  return {
    blocked: true,
    probes,
    container: first.container,
    state: first.state,
    remedy: slotSubstrateRemedy(first.container, first.error),
  };
}
