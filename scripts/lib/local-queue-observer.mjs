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
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return new Map();
  }
  const bySession = new Map();
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const token = entry.slice(0, -".json".length);
    const record = readObserver(observerPath(directory, token));
    if (
      record?.schema !== OBSERVER_SCHEMA
      // The file name is the token: a record claiming a different one is not
      // trustworthy liveness proof.
      || record.observerToken !== token
      || !Number.isInteger(record.pid)
      || record.pid <= 0
      || typeof record.ownerSessionId !== "string"
      || typeof record.registeredAt !== "string"
    ) {
      continue;
    }
    // A duplicate session id would make "which process owns this?" ambiguous,
    // so refuse to treat either as proof rather than guessing.
    if (bySession.has(record.ownerSessionId)) {
      bySession.set(record.ownerSessionId, null);
      continue;
    }
    bySession.set(record.ownerSessionId, record);
  }
  return bySession;
}

export function findDeadLocalQueueObservers({
  directory,
  queuedLeases,
  processAlive = isProcessAlive,
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
    const record = bySession.get(lease.ownerSessionId);
    if (!record) continue;
    if (processAlive(record.pid)) continue;
    dead.push({
      leaseId: lease.leaseId,
      ownerSessionId: lease.ownerSessionId,
      reason: "same_host_observer_process_not_running",
      livenessProof: {
        schema: OBSERVER_SCHEMA,
        observerToken: record.observerToken,
        pid: record.pid,
        registeredAt: record.registeredAt,
      },
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
