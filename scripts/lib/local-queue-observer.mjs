import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const OBSERVER_SCHEMA = "dpf-local-ci-queue-observer/v1";
const OWNER_PATTERN =
  /^gate-v2-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([1-9][0-9]*)$/i;

// BI-2C7F51BA Defect 2 — `process.kill(pid, 0)` alone is an UNSOUND liveness
// proof. Windows recycles PIDs aggressively, so a record whose pid has been
// reassigned to an unrelated process reads as alive forever and can never be
// reaped: a permanent queue-slot leak. Two independent bounds close that:
//
//   1. START TIME. The pair (pid, process start time) IS unique, so recording
//      the observer process's own start time lets a later reap detect that the
//      pid now belongs to a DIFFERENT process. This is the sound check and it
//      fires within one gate launch.
//   2. TTL. When the platform start-time query is unavailable (unsupported
//      shell, hardened host, pre-BI-2C7F51BA record with no `startedAt`) there
//      is no proof either way, so a record may not outlive a plausible gate
//      run. `--lease-wait-seconds` defaults to 7200 (2h) of admission waiting
//      plus the run itself; 12h is comfortably above any honest gate and far
//      below the multi-DAY leaks observed in the field.
export const OBSERVER_RECORD_TTL_MS = 12 * 60 * 60 * 1000;

// `startedAt` is derived from `process.uptime()` (V8 init) while the platform
// reports true process creation, and `ps -o lstart` has 1-second resolution.
// Those disagree by well under a second; a recycled pid disagrees by minutes to
// days. 10s separates the two without ever mistaking clock noise for reuse.
const START_TIME_TOLERANCE_MS = 10_000;

// The reap runs on every admission-loop iteration (~10s while queued, for up to
// 2h). Shelling out that often would be gratuitous, and process start times do
// not change for a live pid — cache the snapshot briefly.
const START_TIME_CACHE_TTL_MS = 60_000;

function readObserver(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function observerPath(directory, token) {
  return join(directory, `${token}.json`);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** This process's start time, as an ISO string, sourced the same way on every
 *  platform so a record written on one host reads the same on the next launch. */
export function processStartedAt({ now = () => Date.now(), uptime = () => process.uptime() } = {}) {
  return new Date(now() - Math.round(uptime() * 1000)).toISOString();
}

function parseStartTimeLines(stdout) {
  const map = new Map();
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.*\S)\s*$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const started = Date.parse(match[2]);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(started)) continue;
    map.set(pid, started);
  }
  return map;
}

/**
 * A single batched snapshot of `pid -> process start time (epoch ms)`.
 *
 * Batched on purpose: the leaked directory observed in the field held 192
 * records, and one shell-out per record would take tens of seconds on Windows.
 * Returns `null` — meaning "unknown", never "dead" — when the platform query is
 * unavailable, so an unreadable process table can never cause a LIVE gate's
 * lease to be cancelled. The TTL above is the bound that still applies.
 */
export function readProcessStartTimes({
  platform = process.platform,
  spawnSyncImpl = spawnSync,
} = {}) {
  try {
    if (platform === "win32") {
      const result = spawnSyncImpl("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.CreationDate.ToUniversalTime().ToString('o'))\" }",
      ], { encoding: "utf8", windowsHide: true });
      if (result.status !== 0 || !result.stdout) return null;
      const map = parseStartTimeLines(result.stdout);
      return map.size > 0 ? map : null;
    }
    const result = spawnSyncImpl("ps", ["-eo", "pid=,lstart="], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout) return null;
    const map = parseStartTimeLines(result.stdout);
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

let startTimeSnapshot = null;

function cachedProcessStartTimes(nowMs) {
  if (startTimeSnapshot && nowMs - startTimeSnapshot.at < START_TIME_CACHE_TTL_MS) {
    return startTimeSnapshot.map;
  }
  startTimeSnapshot = { at: nowMs, map: readProcessStartTimes() };
  return startTimeSnapshot.map;
}

/**
 * Build the liveness predicate the reapers share.
 *
 * Returns `{ alive, reason }`. Every "dead" verdict must be PROVEN — an
 * unavailable start-time snapshot or a missing `startedAt` on an older record
 * yields "alive" and leaves the TTL as the only bound, because cancelling a
 * live gate's lease is strictly worse than reaping a leaked record late.
 */
export function createObserverLivenessProbe({
  processAlive = isProcessAlive,
  processStartTimes,
  now = () => Date.now(),
  ttlMs = OBSERVER_RECORD_TTL_MS,
} = {}) {
  let snapshot = processStartTimes;
  let snapshotResolved = processStartTimes !== undefined;
  return (record) => {
    const nowMs = now();
    // Most specific proof first, so the reap reports WHY rather than just that
    // the record was old enough to give up on.
    if (!processAlive(record?.pid)) {
      return { alive: false, reason: "same_host_observer_process_not_running" };
    }
    const registeredAt = Date.parse(record?.registeredAt ?? "");
    if (Number.isFinite(registeredAt) && nowMs - registeredAt > ttlMs) {
      return { alive: false, reason: "same_host_observer_record_expired" };
    }
    const recordedStart = Date.parse(record?.startedAt ?? "");
    if (!Number.isFinite(recordedStart)) return { alive: true, reason: "" };
    if (!snapshotResolved) {
      snapshot = cachedProcessStartTimes(nowMs);
      snapshotResolved = true;
    }
    const actualStart = snapshot?.get?.(record.pid);
    if (!Number.isFinite(actualStart)) return { alive: true, reason: "" };
    if (Math.abs(actualStart - recordedStart) <= START_TIME_TOLERANCE_MS) {
      return { alive: true, reason: "" };
    }
    return { alive: false, reason: "same_host_observer_pid_recycled" };
  };
}

function readObserverRecords(directory) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const token = entry.slice(0, -".json".length);
    const path = observerPath(directory, token);
    const record = readObserver(path);
    if (
      record?.schema !== OBSERVER_SCHEMA
      || record.observerToken !== token
      || !Number.isInteger(record.pid)
      || record.pid <= 0
      || typeof record.ownerSessionId !== "string"
      || typeof record.registeredAt !== "string"
    ) {
      continue;
    }
    records.push({ path, record });
  }
  return records;
}

export function createGateObserverIdentity({
  pid = process.pid,
  token = randomUUID(),
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("local_queue_observer_invalid_pid");
  }
  if (!OWNER_PATTERN.test(`gate-v2-${token}-${pid}`)) {
    throw new Error("local_queue_observer_invalid_token");
  }
  return {
    token,
    pid,
    ownerSessionId: `gate-v2-${token}-${pid}`,
  };
}

export function registerLocalQueueObserver({
  directory,
  identity,
  branch,
  sha,
  // BI-3A34D7A9: the session id the LEASE carries, which is the owning client
  // thread and no longer encodes this observer's token/pid. Defaults to the
  // observer's own id so pre-existing callers keep working unchanged.
  ownerSessionId = identity.ownerSessionId,
  now = () => new Date(),
  // BI-2C7F51BA Defect 2: the pid's own start time, so a later reap can tell
  // "this gate is still running" from "this pid was recycled".
  startedAt = processStartedAt(),
}) {
  mkdirSync(directory, { recursive: true });
  const path = observerPath(directory, identity.token);
  const record = {
    schema: OBSERVER_SCHEMA,
    observerToken: identity.token,
    pid: identity.pid,
    ownerSessionId,
    branch,
    sha,
    registeredAt: now().toISOString(),
    startedAt,
  };
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { path, record };
}

/**
 * Read every observer record in the directory, keyed by the owner session id it
 * registered for.
 *
 * Enumerating the records is what lets a lease carry an HONEST owner session id
 * (the client thread) instead of one that has to encode this liveness proof.
 * The token stays the file name and the release credential; it is no longer
 * required to be a substring of the lease's identity.
 */
function readObserversBySession(directory) {
  const bySession = new Map();
  for (const { record } of readObserverRecords(directory)) {
    const records = bySession.get(record.ownerSessionId) || [];
    records.push(record);
    bySession.set(record.ownerSessionId, records);
  }
  return bySession;
}

export function findDeadLocalQueueObservers({
  directory,
  queuedLeases,
  processAlive = isProcessAlive,
  processStartTimes,
  now = () => Date.now(),
  observerAlive = createObserverLivenessProbe({ processAlive, processStartTimes, now }),
}) {
  const dead = [];
  const bySession = readObserversBySession(directory);
  for (const lease of queuedLeases) {
    if (
      lease?.environmentKey !== "local-integration-ci"
      || lease?.status !== "queued"
      || typeof lease?.ownerSessionId !== "string"
    ) {
      continue;
    }
    const records = bySession.get(lease.ownerSessionId);
    if (!Array.isArray(records) || records.length === 0) continue;
    const verdicts = records.map((record) => ({ record, verdict: observerAlive(record) }));
    if (verdicts.some(({ verdict }) => verdict.alive)) continue;
    const livenessProofs = verdicts.map(({ record, verdict }) => ({
      schema: OBSERVER_SCHEMA,
      observerToken: record.observerToken,
      pid: record.pid,
      registeredAt: record.registeredAt,
      ...(record.startedAt ? { startedAt: record.startedAt } : {}),
      reason: verdict.reason,
    }));
    dead.push({
      leaseId: lease.leaseId,
      ownerSessionId: lease.ownerSessionId,
      reason: livenessProofs[0].reason,
      livenessProof: livenessProofs[0],
      ...(livenessProofs.length > 1 ? { livenessProofs } : {}),
    });
  }
  return dead;
}

export function releaseLocalQueueObserver({ path, token }) {
  const record = readObserver(path);
  if (!record) return { status: "absent" };
  if (record.observerToken !== token) {
    return { status: "not-owner", active: record };
  }
  unlinkSync(path);
  return { status: "released" };
}

/**
 * Reap dead observer records from the directory.
 *
 * BI-2C7F51BA Defect 1: this is the ONLY thing that stops leaked records
 * accumulating forever, and until that item it was wired exclusively into
 * pregate's interrupted/revival recovery paths — which are themselves skipped
 * when the worktree path cannot be resolved, i.e. on the very failure the
 * cleanup exists for. It now runs on every gate startup instead.
 *
 * DO NOT default the branch/sha/ownerSessionId filters to the calling gate's
 * own values. A startup sweep leaves them EMPTY so it clears OTHER sessions'
 * dead records too; that cross-session behaviour is the entire point, because
 * the queue is shared by every session on the host and the session that leaked
 * a record is by definition no longer around to clean it up. "Tightening" this
 * to the current branch silently restores the leak.
 *
 * `retainOwnerSessionIds` is the one narrowing that is safe: a record is the
 * liveness PROOF that lets `findDeadLocalQueueObservers` cancel a dead waiter's
 * lease, so sweeping a record whose lease is still queued would strand that
 * lease in the queue permanently — trading a leaked file for a leaked slot.
 * Callers that hold a lease listing pass those session ids here and let the
 * lease reconciler consume the proof first.
 */
export function releaseDeadLocalQueueObserversForGate({
  directory,
  branch,
  sha,
  ownerSessionId = "",
  retainOwnerSessionIds,
  processAlive = isProcessAlive,
  processStartTimes,
  now = () => Date.now(),
  observerAlive = createObserverLivenessProbe({ processAlive, processStartTimes, now }),
}) {
  const retained = retainOwnerSessionIds instanceof Set
    ? retainOwnerSessionIds
    : new Set(Array.isArray(retainOwnerSessionIds) ? retainOwnerSessionIds : []);
  const released = [];
  for (const { path, record } of readObserverRecords(directory)) {
    if (branch && record.branch !== branch) continue;
    if (sha && record.sha !== sha) continue;
    if (ownerSessionId && record.ownerSessionId !== ownerSessionId) continue;
    if (retained.has(record.ownerSessionId)) continue;
    const verdict = observerAlive(record);
    if (verdict.alive) continue;
    const result = releaseLocalQueueObserver({
      path,
      token: record.observerToken,
    });
    released.push({
      schema: OBSERVER_SCHEMA,
      observerToken: record.observerToken,
      pid: record.pid,
      ownerSessionId: record.ownerSessionId,
      branch: record.branch,
      sha: record.sha,
      registeredAt: record.registeredAt,
      ...(record.startedAt ? { startedAt: record.startedAt } : {}),
      reason: verdict.reason,
      releaseStatus: result.status,
    });
  }
  return released;
}
