import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { isProcessAlive, readProcessIdentity } from "./local-sandbox-fence.mjs";

export const CONVERGENCE_LOCK_STALE_MS = 30 * 60_000;
const OWNER_FILE = "owner.json";

function readOwner(path) {
  try {
    return JSON.parse(readFileSync(join(path, OWNER_FILE), "utf8"));
  } catch {
    return null;
  }
}

function validOwner(owner) {
  return owner?.schema === "dpf-local-convergence-lock/v1"
    && typeof owner.token === "string"
    && owner.token.length > 0
    && Number.isInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.processIdentity === "string"
    && owner.processIdentity.length > 0
    && typeof owner.acquiredAt === "string";
}

export function inspectLocalConvergenceLock({
  path,
  now = () => new Date(),
  staleMs = CONVERGENCE_LOCK_STALE_MS,
  processAlive = isProcessAlive,
  processIdentity = readProcessIdentity,
}) {
  if (!existsSync(path)) return { status: "absent", owner: null };
  const owner = readOwner(path);
  if (validOwner(owner)) {
    if (!processAlive(owner.pid)) return { status: "stale", owner };
    const identity = processIdentity(owner.pid);
    if (!identity) return { status: "unmeasurable", owner };
    return identity === owner.processIdentity
      ? { status: "live", owner }
      : { status: "stale", owner };
  }

  // Compatibility for locks created before owner metadata existed. A recent
  // empty directory may be between mkdir and owner.json, so it stays closed.
  try {
    const ageMs = now().getTime() - statSync(path).mtimeMs;
    return ageMs > staleMs
      ? { status: "stale-legacy", owner: null }
      : { status: "legacy-live", owner: null };
  } catch {
    return { status: "unmeasurable", owner: null };
  }
}

export function reconcileStaleLocalConvergenceLock(input) {
  const inspection = inspectLocalConvergenceLock(input);
  if (!["stale", "stale-legacy"].includes(inspection.status)) return inspection;

  const orphanPath = `${input.path}.orphan-${process.pid}-${Date.now()}`;
  try {
    renameSync(input.path, orphanPath);
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) {
      return { status: "contended", owner: inspection.owner };
    }
    throw error;
  }

  const moved = inspectLocalConvergenceLock({ ...input, path: orphanPath });
  const sameOwner = inspection.owner
    ? moved.owner?.token === inspection.owner.token
      && moved.owner?.pid === inspection.owner.pid
      && moved.owner?.processIdentity === inspection.owner.processIdentity
    : moved.status === "stale-legacy";
  if (!sameOwner || !["stale", "stale-legacy"].includes(moved.status)) {
    try {
      renameSync(orphanPath, input.path);
    } catch {
      // Another owner won the original path. Keep the unexpected directory
      // quarantined; the next observation remains fail-closed.
    }
    return { status: "contended", owner: moved.owner };
  }
  rmSync(orphanPath, { recursive: true, force: true });
  return { status: "reconciled", owner: inspection.owner };
}

export function acquireLocalConvergenceLock({
  path,
  pid = process.pid,
  now = () => new Date(),
  processAlive = isProcessAlive,
  processIdentity = readProcessIdentity,
  token = randomUUID(),
}) {
  const identity = processIdentity(pid);
  if (!identity) throw new Error(`cannot establish convergence owner identity for ${pid}`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(path, { recursive: false });
      const owner = {
        schema: "dpf-local-convergence-lock/v1",
        token,
        pid,
        processIdentity: identity,
        acquiredAt: now().toISOString(),
      };
      writeFileSync(join(path, OWNER_FILE), `${JSON.stringify(owner, null, 2)}\n`, { flag: "wx" });
      return { status: "acquired", owner };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        // A write failure after mkdir must not leave an ownerless lock behind.
        if (!readOwner(path)) rmSync(path, { recursive: true, force: true });
        throw error;
      }
    }
    const reconciled = reconcileStaleLocalConvergenceLock({
      path, now, processAlive, processIdentity,
    });
    if (reconciled.status !== "reconciled") {
      return { status: "conflict", active: reconciled };
    }
  }
  return { status: "conflict", active: inspectLocalConvergenceLock({ path, now, processAlive, processIdentity }) };
}

export function releaseLocalConvergenceLock({ path, token }) {
  if (!existsSync(path)) return { status: "absent" };
  const owner = readOwner(path);
  if (!validOwner(owner) || owner.token !== token) return { status: "not-owner", active: owner };
  rmSync(path, { recursive: true, force: true });
  return { status: "released" };
}
