import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const MAX_OBSERVATIONS = 120;
const TRANSIENT_RENAME_CODES = new Set(["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"]);
let tempSequence = 0;

export function readStageReceipt(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function stageIdentityMatches(left, right) {
  if (!left || !right) return false;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function reusablePassedStage({ receipt, stage, identity }) {
  return Boolean(
    receipt
      && receipt.schemaVersion === 1
      && receipt.stage === stage
      && receipt.status === "passed"
      && stageIdentityMatches(receipt.identity, identity),
  );
}

export function canonicalStageReceiptStatus(status) {
  return status === "healthy" ? "passed" : status;
}

export function classifyPriorStage({ receipt, isProcessAlive = () => false }) {
  if (!receipt || receipt.status !== "running") return "terminal-or-absent";
  return Number.isInteger(receipt.hostPid) && isProcessAlive(receipt.hostPid)
    ? "still-running"
    : "externally-terminated";
}

function sleepSync(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

export function atomicWriteJson(path, payload, {
  renameImpl = renameSync,
  removeImpl = rmSync,
  sleepImpl = sleepSync,
  maxRenameAttempts = 8,
  retryDelayMs = 25,
} = {}) {
  if (!path) return;
  tempSequence += 1;
  const temp = `${path}.tmp-${process.pid}-${tempSequence}`;
  writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`);
  try {
    for (let attempt = 1; attempt <= maxRenameAttempts; attempt += 1) {
      try {
        renameImpl(temp, path);
        return;
      } catch (error) {
        const retryable = TRANSIENT_RENAME_CODES.has(error?.code);
        if (!retryable || attempt === maxRenameAttempts) throw error;
        sleepImpl(retryDelayMs * attempt);
      }
    }
  } finally {
    removeImpl(temp, { force: true });
  }
}

export function markStageReceiptReused({
  path,
  receipt,
  now = () => new Date(),
} = {}) {
  if (!receipt || receipt.status !== "passed") {
    throw new TypeError("only a passed stage receipt can be marked reused");
  }
  const payload = {
    ...receipt,
    reused: true,
    reuseCount: Number(receipt.reuseCount ?? 0) + 1,
    lastReusedAt: now().toISOString(),
  };
  atomicWriteJson(path, payload);
  return payload;
}

export function createStageReceiptWriter({
  path,
  stage,
  identity,
  now = () => new Date(),
  hostPid = process.pid,
} = {}) {
  if (!stage || !identity) {
    throw new TypeError("stage receipt requires stage and identity");
  }
  let payload = null;

  const persist = () => {
    atomicWriteJson(path, payload);
    return payload;
  };

  return {
    start(details = {}) {
      const observedAt = now().toISOString();
      payload = {
        ...details,
        schemaVersion: 1,
        stage,
        identity,
        status: "running",
        hostPid,
        startedAt: observedAt,
        lastHeartbeatAt: observedAt,
        completedAt: null,
        observations: [],
      };
      return persist();
    },
    heartbeat(observation = {}) {
      if (!payload) throw new Error("stage receipt must start before heartbeat");
      const observedAt = now().toISOString();
      payload = {
        ...payload,
        status: "running",
        lastHeartbeatAt: observedAt,
        observations: [
          ...(payload.observations ?? []),
          { observedAt, ...observation },
        ].slice(-MAX_OBSERVATIONS),
      };
      return persist();
    },
    complete(status, details = {}) {
      if (!payload) throw new Error("stage receipt must start before completion");
      const observedAt = now().toISOString();
      payload = {
        ...payload,
        ...details,
        schemaVersion: 1,
        stage,
        identity,
        status,
        lastHeartbeatAt: observedAt,
        completedAt: observedAt,
      };
      return persist();
    },
    snapshot() {
      return payload;
    },
  };
}
