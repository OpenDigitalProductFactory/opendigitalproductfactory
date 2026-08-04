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
import { performance } from "node:perf_hooks";

const OBSERVER_SCHEMA = "dpf-local-ci-queue-observer/v1";
const OWNER_PATTERN =
  /^gate-v2-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([1-9][0-9]*)$/i;

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

/**
 * BI-2C7F51BA defect 2 — `process.kill(pid, 0)` alone is an UNSOUND liveness
 * proof, and unsoundly in the direction that wedges the queue: Windows recycles
 * pids aggressively, so a record whose gate died reads as alive FOREVER once the
 * OS hands its pid to an unrelated process. Such a record can never be reaped and
 * permanently leaks a queue slot. (Observed live: 6 surviving records, 4 of them
 * registered days earlier, all "alive".)
 *
 * (pid, startTime) IS unique, so the record now carries the registering process's
 * start time and liveness compares it against the host's real process table. Two
 * independent guarantees follow:
 *
 *   - VERIFIED LIVE — pid present in the host table with a matching start time.
 *     A genuinely running gate is never reaped, no matter how long it runs. The
 *     TTL below deliberately does NOT apply to this case.
 *   - UNVERIFIABLE — no start time on the record (pre-fix record), or the host
 *     table could not be read. Falls back to pid-only liveness PLUS the TTL, so
 *     no record can outlive a plausible gate run regardless of pid state.
 *
 * A pid whose start time does NOT match is proven reuse: dead, reaped now.
 */
const START_TIME_TOLERANCE_MS = 2_000;

/**
 * TTL backstop for records whose liveness cannot be positively verified. A local
 * gate run is minutes-to-an-hour; 4h is far past any plausible run, and it only
 * ever applies when the start-time proof is unavailable — so it cannot reap a
 * gate we can see is still running.
 */
export const OBSERVER_TTL_MS = 4 * 60 * 60 * 1000;

/** How long a host process-table snapshot may be reused (the reaper runs inside
 *  the gate's claim-retry loop; re-shelling out every few seconds is waste). */
const PROCESS_TABLE_CACHE_MS = 15_000;

let processTableCache = null;

function currentProcessStartedAtMs() {
  // performance.timeOrigin is this process's start, as epoch ms.
  return Math.round(performance.timeOrigin);
}

function parseProcessTable(stdout) {
  const table = new Map();
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^\s*(\d+)[\s,]+(-?\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const startedAtMs = Number.parseInt(match[2], 10);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(startedAtMs)) continue;
    table.set(pid, startedAtMs);
  }
  return table;
}

/**
 * Snapshot every running pid with its start time as epoch ms, or null when the
 * host cannot be queried. Null (not an empty map) is the failure signal, so an
 * unreadable process table can never be mistaken for "nothing is running" and
 * mass-reap live gates.
 */
export function readHostProcessStartTimes({
  platform = process.platform,
  run = spawnSync,
  nowMs = Date.now(),
} = {}) {
  try {
    let result;
    if (platform === "win32") {
      // Emit "<pid> <epochMs>" per line; computing the epoch inside PowerShell
      // keeps the output locale-independent.
      const script =
        "Get-CimInstance Win32_Process | ForEach-Object { "
        + "if ($_.CreationDate) { "
        + "'{0} {1}' -f $_.ProcessId, "
        + "[int64]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } }";
      result = run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", windowsHide: true, timeout: 20_000 },
      );
    } else {
      // etimes = elapsed seconds; start = now - elapsed. Second-granularity, which
      // the tolerance above already accommodates.
      result = run("ps", ["-Ao", "pid=,etimes="], { encoding: "utf8", timeout: 20_000 });
    }
    if (result?.status !== 0 || typeof result.stdout !== "string") return null;
    const raw = parseProcessTable(result.stdout);
    if (raw.size === 0) return null;
    if (platform === "win32") return raw;
    const table = new Map();
    for (const [pid, elapsedSeconds] of raw) table.set(pid, nowMs - elapsedSeconds * 1000);
    return table;
  } catch {
    return null;
  }
}

function hostProcessStartTimes(nowMs = Date.now()) {
  if (processTableCache && nowMs - processTableCache.at < PROCESS_TABLE_CACHE_MS) {
    return processTableCache.table;
  }
  const table = readHostProcessStartTimes({ nowMs });
  processTableCache = { at: nowMs, table };
  return table;
}

/** Test seam: drop the memoized host process table. */
export function resetHostProcessTableCache() {
  processTableCache = null;
}

/**
 * Decide whether one observer record still represents a running gate. See
 * START_TIME_TOLERANCE_MS above for the two-guarantee argument.
 */
export function isObserverRecordLive(record, {
  processAlive = isProcessAlive,
  processStartTimes = null,
  ttlMs = OBSERVER_TTL_MS,
  nowMs = Date.now(),
} = {}) {
  if (!processAlive(record.pid)) return false;

  const observedStartedAtMs = processStartTimes instanceof Map
    ? processStartTimes.get(record.pid)
    : undefined;
  const recordedStartedAtMs = Number.isFinite(record.processStartedAtMs)
    ? record.processStartedAtMs
    : null;

  if (observedStartedAtMs !== undefined && recordedStartedAtMs !== null) {
    // Positive proof either way — no TTL needed in either direction.
    return Math.abs(observedStartedAtMs - recordedStartedAtMs) <= START_TIME_TOLERANCE_MS;
  }
  if (processStartTimes instanceof Map && observedStartedAtMs === undefined) {
    // We can see the whole host table and this pid is not in it: kill(0) lied.
    return false;
  }

  // Unverifiable: pid-only liveness, bounded by the TTL so nothing leaks forever.
  const registeredAtMs = Date.parse(record.registeredAt);
  if (Number.isFinite(registeredAtMs) && nowMs - registeredAtMs > ttlMs) return false;
  return true;
}

/**
 * Build the liveness predicate the reapers use. An injected `processAlive`
 * (tests, callers with their own oracle) is authoritative on its own: it is not
 * second-guessed against the real host process table.
 */
function resolveObserverAlive({
  observerAlive,
  processAlive,
  processStartTimes,
  ttlMs = OBSERVER_TTL_MS,
  nowMs = Date.now(),
}) {
  if (typeof observerAlive === "function") return observerAlive;
  const startTimes = processStartTimes !== undefined
    ? processStartTimes
    : (processAlive ? null : hostProcessStartTimes(nowMs));
  const alive = processAlive || isProcessAlive;
  return (record) =>
    isObserverRecordLive(record, {
      processAlive: alive,
      processStartTimes: startTimes,
      ttlMs,
      nowMs,
    });
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
  // BI-2C7F51BA: (pid, startTime) is unique where pid alone is not. Defaults to
  // THIS process's start time, which is the only one we can read without asking
  // the OS; callers registering on behalf of another pid must pass it.
  processStartedAtMs = identity.pid === process.pid ? currentProcessStartedAtMs() : null,
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
    ...(Number.isFinite(processStartedAtMs) ? { processStartedAtMs } : {}),
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
  processAlive,
  processStartTimes,
  observerAlive: observerAliveOverride,
  ttlMs,
  nowMs,
}) {
  const observerAlive = resolveObserverAlive({
    observerAlive: observerAliveOverride,
    processAlive,
    processStartTimes,
    ttlMs,
    nowMs,
  });
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
    if (records.some((record) => observerAlive(record))) continue;
    const livenessProofs = records.map((record) => ({
      schema: OBSERVER_SCHEMA,
      observerToken: record.observerToken,
      pid: record.pid,
      registeredAt: record.registeredAt,
    }));
    dead.push({
      leaseId: lease.leaseId,
      ownerSessionId: lease.ownerSessionId,
      reason: "same_host_observer_process_not_running",
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

export function releaseDeadLocalQueueObserversForGate({
  directory,
  branch,
  sha,
  ownerSessionId = "",
  processAlive,
  processStartTimes,
  observerAlive: observerAliveOverride,
  ttlMs,
  nowMs,
}) {
  const observerAlive = resolveObserverAlive({
    observerAlive: observerAliveOverride,
    processAlive,
    processStartTimes,
    ttlMs,
    nowMs,
  });
  const released = [];
  for (const { path, record } of readObserverRecords(directory)) {
    if (branch && record.branch !== branch) continue;
    if (sha && record.sha !== sha) continue;
    if (ownerSessionId && record.ownerSessionId !== ownerSessionId) continue;
    if (observerAlive(record)) continue;
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
      ...(Number.isFinite(record.processStartedAtMs)
        ? { processStartedAtMs: record.processStartedAtMs }
        : {}),
      releaseStatus: result.status,
    });
  }
  return released;
}
