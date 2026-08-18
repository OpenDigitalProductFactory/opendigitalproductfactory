import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import { isEntryModule } from "./entry-module.mjs";

const DEFAULT_MAX_HEARTBEAT_AGE_MS = 8 * 60 * 1000;

function readFence(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isVersionedFenceRecord(record) {
  return record?.schema === "dpf-local-sandbox-fence/v1"
    && typeof record.token === "string"
    && record.token.length > 0
    && Number.isInteger(record.pid)
    && record.pid > 0
    && typeof record.processIdentity === "string"
    && record.processIdentity.length > 0;
}

/**
 * Reconcile only fences whose recorded process can no longer be the owner.
 * Live owners and records we cannot measure remain fail-closed.
 */
export function reconcileDeadLocalSandboxFence({
  path,
  processAlive = isProcessAlive,
  processIdentity = readProcessIdentity,
}) {
  const record = readFence(path);
  if (!record) return { status: "absent", record: null };
  if (!isVersionedFenceRecord(record)) return { status: "invalid", record };

  if (processAlive(record.pid)) {
    const identity = processIdentity(record.pid);
    if (!identity) return { status: "unmeasurable", record };
    if (identity === record.processIdentity) return { status: "live", record };
  }

  const orphanPath = `${path}.orphan-${process.pid}-${Date.now()}`;
  try {
    renameSync(path, orphanPath);
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) {
      return { status: "contended", record };
    }
    throw error;
  }

  const moved = readFence(orphanPath);
  if (
    moved?.token !== record.token
    || moved?.pid !== record.pid
    || moved?.processIdentity !== record.processIdentity
  ) {
    try {
      renameSync(orphanPath, path);
    } catch {
      // Another owner won the path. Leave the unexpected record quarantined;
      // admission remains fail-closed for this observation.
    }
    return { status: "contended", record: moved };
  }

  unlinkSync(orphanPath);
  return { status: "reconciled", record };
}

export function inspectLocalSandboxFence({
  path,
  processAlive = isProcessAlive,
  processIdentity = readProcessIdentity,
  now = () => new Date(),
  maxHeartbeatAgeMs = DEFAULT_MAX_HEARTBEAT_AGE_MS,
}) {
  const record = readFence(path);
  if (!record) return { status: "absent", record: null };
  if (
    !isVersionedFenceRecord(record)
    || typeof record.heartbeatAt !== "string"
  ) {
    return { status: "invalid", record };
  }
  const heartbeatMs = Date.parse(record.heartbeatAt);
  const ageMs = now().getTime() - heartbeatMs;
  if (
    !Number.isFinite(heartbeatMs)
    || !Number.isFinite(maxHeartbeatAgeMs)
    || maxHeartbeatAgeMs <= 0
    || ageMs < 0
    || ageMs > maxHeartbeatAgeMs
  ) {
    return { status: "stale", record };
  }
  if (!processAlive(record.pid)) return { status: "stale", record };
  if (processIdentity(record.pid) !== record.processIdentity) {
    return { status: "stale", record };
  }
  return { status: "live", record };
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readProcessIdentity(
  pid,
  {
    platform = process.platform,
    spawnSyncImpl = spawnSync,
    readFileSyncImpl = readFileSync,
  } = {},
) {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  if (platform === "linux") {
    try {
      const stat = readFileSyncImpl(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
      const startTicks = fields[19];
      return startTicks ? `linux:${startTicks}` : "";
    } catch {
      return "";
    }
  }
  if (platform === "win32") {
    const result = spawnSyncImpl("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
    ], { encoding: "utf8", windowsHide: true });
    const startedAtTicks = result.status === 0 ? result.stdout.trim() : "";
    return /^\d+$/.test(startedAtTicks) ? `win32:${startedAtTicks}` : "";
  }
  const result = spawnSyncImpl("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
  });
  const startedAtMs = result.status === 0 ? Date.parse(result.stdout.trim()) : Number.NaN;
  return Number.isFinite(startedAtMs) ? `${platform}:${startedAtMs}` : "";
}

export function acquireLocalSandboxFence({
  path,
  ownerSessionId,
  branch,
  pid = process.pid,
  now = () => new Date(),
  processAlive = isProcessAlive,
  processIdentity = readProcessIdentity,
  token = randomUUID(),
}) {
  const ownerProcessIdentity = processIdentity(pid);
  if (!ownerProcessIdentity) {
    throw new Error(`cannot establish process-start identity for sandbox fence owner ${pid}`);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timestamp = now().toISOString();
    const record = {
      schema: "dpf-local-sandbox-fence/v1",
      token,
      pid,
      processIdentity: ownerProcessIdentity,
      ownerSessionId,
      branch,
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
    };
    try {
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
      } finally {
        closeSync(fd);
      }
      return { status: "acquired", record };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    const inspection = inspectLocalSandboxFence({
      path,
      processAlive,
      processIdentity,
      now,
    });
    const invalidLiveOwner = inspection.status === "invalid"
      && processAlive(Number(inspection.record?.pid));
    if (inspection.status === "live" || invalidLiveOwner) {
      return { status: "conflict", active: inspection.record };
    }

    const orphanPath = `${path}.orphan-${process.pid}-${Date.now()}`;
    try {
      renameSync(path, orphanPath);
      unlinkSync(orphanPath);
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM"].includes(error?.code)) throw error;
    }
  }
  return { status: "conflict", active: readFence(path) };
}

export function heartbeatLocalSandboxFence({ path, token, now = () => new Date() }) {
  const record = readFence(path);
  if (!record || record.token !== token) return { status: "lost" };
  const updated = { ...record, heartbeatAt: now().toISOString() };
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
  return { status: "renewed", record: updated };
}

export function releaseLocalSandboxFence({ path, token }) {
  const record = readFence(path);
  if (!record) return { status: "absent" };
  if (record.token !== token) return { status: "not-owner", active: record };
  unlinkSync(path);
  return { status: "released" };
}

function cli() {
  const [command, path, tokenOrOwner, branchOrPid] = process.argv.slice(2);
  let result;
  if (command === "acquire") {
    result = acquireLocalSandboxFence({
      path,
      ownerSessionId: tokenOrOwner,
      branch: branchOrPid,
      pid: Number(process.env.DPF_LOCAL_FENCE_PID || process.ppid),
    });
  } else if (command === "heartbeat") {
    result = heartbeatLocalSandboxFence({ path, token: tokenOrOwner });
  } else if (command === "release") {
    result = releaseLocalSandboxFence({ path, token: tokenOrOwner });
  } else {
    throw new Error("usage: local-sandbox-fence.mjs acquire PATH OWNER BRANCH | heartbeat PATH TOKEN | release PATH TOKEN");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isEntryModule(import.meta.url)) {
  try {
    cli();
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
