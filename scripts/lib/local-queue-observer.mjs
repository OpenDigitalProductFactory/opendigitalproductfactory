import { randomUUID } from "node:crypto";
import {
  mkdirSync,
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
  now = () => new Date(),
}) {
  mkdirSync(directory, { recursive: true });
  const path = observerPath(directory, identity.token);
  const record = {
    schema: OBSERVER_SCHEMA,
    observerToken: identity.token,
    pid: identity.pid,
    ownerSessionId: identity.ownerSessionId,
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

export function findDeadLocalQueueObservers({
  directory,
  queuedLeases,
  processAlive = isProcessAlive,
}) {
  const dead = [];
  for (const lease of queuedLeases) {
    if (
      lease?.environmentKey !== "local-integration-ci"
      || lease?.status !== "queued"
      || typeof lease?.ownerSessionId !== "string"
    ) {
      continue;
    }
    const match = OWNER_PATTERN.exec(lease.ownerSessionId);
    if (!match) continue;
    const [, token, pidText] = match;
    const pid = Number(pidText);
    const record = readObserver(observerPath(directory, token));
    if (
      record?.schema !== OBSERVER_SCHEMA
      || record.observerToken !== token
      || record.pid !== pid
      || record.ownerSessionId !== lease.ownerSessionId
      || typeof record.registeredAt !== "string"
    ) {
      continue;
    }
    if (processAlive(pid)) continue;
    dead.push({
      leaseId: lease.leaseId,
      ownerSessionId: lease.ownerSessionId,
      reason: "same_host_observer_process_not_running",
      livenessProof: {
        schema: OBSERVER_SCHEMA,
        observerToken: token,
        pid,
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
