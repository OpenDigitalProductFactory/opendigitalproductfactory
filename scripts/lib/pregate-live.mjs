// scripts/lib/pregate-live.mjs
//
// BI-F039AA83 — a pregate that is still working must say so.
//
// `pnpm run pregate:status` reads the gate's records, and the first record is
// written only when the gate itself starts. Everything before that — the
// disk/tree checks, the guard-parity preflight (minutes), the admission request
// — left no trace, so a status read in that window printed
// `NO-RECORD — pregate has not run here` while pregate was running. Observed
// 2026-10-28: Codex read exactly that for pregate pid 4144 / preflight pid
// 15776 and told the founder it was blocked.
//
// The fix is a live marker: pregate writes `dpf-pregate-live.json` into the
// worktree's OWN git dir when it starts, updates its stage as it moves, and
// removes it on exit. The reader trusts the marker only while its process is
// provably the one that wrote it — the same (pid, start time) liveness proof
// the local-CI queue observers already use, so a recycled pid or a marker left
// behind by a killed run reads as "not live", never as a gate that runs forever.

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { createObserverLivenessProbe, processStartedAt } from "./local-queue-observer.mjs";

export const PREGATE_LIVE_MARKER_NAME = "dpf-pregate-live.json";
const MARKER_SCHEMA = "dpf.pregate-live.v1";

/** Stages pregate records as it moves. */
export const PREGATE_LIVE_STAGES = Object.freeze(["preflight", "reduced-tier", "gate"]);

function readMarker(path, readJsonImpl) {
  try {
    const record = readJsonImpl ? readJsonImpl(path) : JSON.parse(readFileSync(path, "utf8"));
    return record?.schema === MARKER_SCHEMA && Number.isInteger(record.pid) && record.pid > 0 ? record : null;
  } catch {
    return null;
  }
}

/** Write (or replace) this process's marker. Never throws: a marker is a courtesy to readers, not a gate prerequisite. */
export function writePregateLiveMarker({
  path, branch, sha, stage = "preflight",
  pid = process.pid, startedAt = processStartedAt(), now = () => new Date(),
}) {
  const at = now().toISOString();
  const record = { schema: MARKER_SCHEMA, pid, branch, sha, stage, startedAt, registeredAt: at, stageAt: at };
  try {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return record;
  } catch {
    return null;
  }
}

/** Move this process's marker to a new stage; a marker owned by another pid is left alone. */
export function updatePregateLiveStage({ path, stage, pid = process.pid, now = () => new Date() }) {
  const record = readMarker(path);
  if (!record || record.pid !== pid) return null;
  const next = { ...record, stage, stageAt: now().toISOString() };
  try {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  } catch {
    return null;
  }
}

/** Remove the marker only when this process owns it. */
export function removePregateLiveMarker({ path, pid = process.pid }) {
  const record = readMarker(path);
  if (!record || record.pid !== pid) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The live pregate for this worktree, or null.
 *
 * @returns {null | { pid: number, stage: string, branch: string, sha: string, startedAt: string, stageAt: string }}
 */
export function readLivePregate({ path, readJsonImpl, observerAlive = createObserverLivenessProbe() }) {
  const record = readMarker(path, readJsonImpl);
  if (!record) return null;
  if (!observerAlive(record).alive) return null;
  return {
    pid: record.pid,
    stage: String(record.stage || "preflight"),
    branch: String(record.branch || ""),
    sha: String(record.sha || ""),
    startedAt: String(record.startedAt || ""),
    stageAt: String(record.stageAt || record.registeredAt || ""),
  };
}

/**
 * A second pregate in the same worktree would race the first for the one gate
 * record. Refuse it and point at the run that is already working.
 */
export function liveGateRefusal(live) {
  if (!live) return null;
  return `a pregate is already running in this worktree (pid ${live.pid}, stage ${live.stage}, `
    + `${live.branch || "unknown branch"} @ ${live.sha.slice(0, 12) || "unknown"}). `
    + "Not starting a second run. Observe it with  pnpm run pregate:status  (exit 75 = still working).";
}
