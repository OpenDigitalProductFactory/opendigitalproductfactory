import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { isProcessAlive, readProcessIdentity } from "./local-sandbox-fence.mjs";

export const CONVERGENCE_LOCK_STALE_MS = 30 * 60_000;
const OWNER_FILE = "owner.json";

// DPF2 owns this host-wide O_EXCL file. Its ci-slot.mjs recognizes a positive
// PID plus a token, uses kill(pid, 0) with EPERM meaning alive, and ages
// incomplete JSON against a 2-second write grace. Its fixed path is a
// coordination endpoint, not a temporary file DPF creates or owns.
const DPF2_CI_RESERVATION_PATH = "/tmp/dpf2-local-ci.lock";
const DPF2_RESERVATION_WAIT_MS = 60 * 60_000;
const DPF2_CORRUPT_GRACE_MS = 2_000;
export const DPF2_RESERVATION_POLL_MS = 30_000;

export function dpf2ReservationDeadline(env = process.env, now = Date.now) {
  const outerDeadline = Number(env.DPF_LOCAL_CI_OUTER_DEADLINE_MS);
  const phaseDeadline = now() + DPF2_RESERVATION_WAIT_MS;
  return Number.isFinite(outerDeadline) && outerDeadline > 0
    ? Math.min(phaseDeadline, outerDeadline) : phaseDeadline;
}

export function dpf2ReservationPath(env = process.env, platform = process.platform) {
  const override = env.DPF2_CI_SLOT_LOCK?.trim();
  return override ? resolve(override) : platform === "darwin" ? DPF2_CI_RESERVATION_PATH : null;
}

function readDpf2Reservation(path) {
  // DPF opens the foreign reservation read-only. Never follow a symlink or
  // substitute path-based checks for verification of the opened descriptor.
  if (!Number.isInteger(constants.O_NOFOLLOW)) return {};
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o022) !== 0) return { mtimeMs: stat.mtimeMs };
    try {
      return { raw: readFileSync(fd, "utf8"), mtimeMs: stat.mtimeMs };
    } catch (error) {
      error.mtimeMs = stat.mtimeMs;
      throw error;
    }
  } finally {
    closeSync(fd);
  }
}

function dpf2PidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function reservationSince(ms) {
  return Number.isFinite(ms) ? { since: new Date(ms).toISOString() } : {};
}

export function inspectDpf2CiReservation({
  env = process.env,
  path = dpf2ReservationPath(env),
  now = Date.now,
  processAlive = dpf2PidAlive,
  read = readDpf2Reservation,
} = {}) {
  if (path === null) return { status: "free" };
  let file;
  try {
    file = read(path);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "free" };
    return { status: "unreadable", ...reservationSince(error?.mtimeMs) };
  }
  const modified = reservationSince(file.mtimeMs);
  if (file.raw === undefined) return { status: "unreadable", ...modified };
  let owner;
  try {
    owner = JSON.parse(file.raw);
  } catch {
    // An exclusive create may have won but not written its metadata yet.
    return {
      status: now() - file.mtimeMs >= DPF2_CORRUPT_GRACE_MS ? "stale-corrupt" : "initializing",
      ...modified,
    };
  }
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0
      || typeof owner.token !== "string" || owner.token.length === 0) {
    return { status: "unknown-owner", ...modified };
  }
  const acquiredMs = typeof owner.acquiredAt === "string" ? Date.parse(owner.acquiredAt) : NaN;
  const holder = { pid: owner.pid, ...modified, ...reservationSince(acquiredMs) };
  try {
    return { status: processAlive(owner.pid) ? "held" : "stale-dead", ...holder };
  } catch {
    return { status: "unreadable", ...holder };
  }
}

export function dpf2ReservationBlocks(reservation) {
  return !["free", "stale-dead", "stale-corrupt"].includes(reservation.status);
}

export function describeDpf2Reservation(reservation) {
  const holder = reservation.pid ? ` (PID ${reservation.pid})` : " (holder unknown)";
  const since = reservation.since ? ` since ${reservation.since}` : " since unknown";
  return `DPF2 quiet-window reservation ${reservation.status}${holder}${since}`;
}

// A read can defer a start, never reserve admission. DPF2 can acquire after
// our last observation. The host-wide thread handshake still owns that race.
export async function waitForDpf2Reservation({
  inspect = inspectDpf2CiReservation,
  now = Date.now,
  deadline = dpf2ReservationDeadline(process.env, now),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  cancelled = () => false,
  notice = console.log,
} = {}) {
  let waited = false;
  for (;;) {
    if (cancelled()) return "cancelled";
    const reservation = inspect();
    if (!dpf2ReservationBlocks(reservation)) {
      if (waited) notice("DPF2 reservation no longer blocks this phase; resuming.");
      return "clear";
    }
    const delayMs = Math.min(DPF2_RESERVATION_POLL_MS, deadline - now());
    const description = describeDpf2Reservation(reservation);
    if (delayMs <= 0) {
      notice(`Timed out waiting for ${description}. No verdict from the blocked phase; resume after DPF2 releases it.`);
      return "deadline";
    }
    waited = true;
    notice(`Waiting for ${description}; checking again in ${Math.ceil(delayMs / 1000)}s.`);
    await sleep(delayMs);
  }
}

export function readLocalConvergenceOwner(path) {
  try {
    return JSON.parse(readFileSync(join(path, OWNER_FILE), "utf8"));
  } catch {
    return null;
  }
}

const readOwner = readLocalConvergenceOwner;

export function validLocalConvergenceOwner(owner) {
  return owner?.schema === "dpf-local-convergence-lock/v1"
    && typeof owner.token === "string"
    && owner.token.length > 0
    && Number.isInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.processIdentity === "string"
    && owner.processIdentity.length > 0
    && typeof owner.acquiredAt === "string";
}

const validOwner = validLocalConvergenceOwner;

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
  reconcileStale = true,
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
    // Receipt mutation locks never reclaim a foreign lock, including legacy
    // or apparently dead owners. Their uncertainty must remain observable.
    if (!reconcileStale) return { status: "conflict", active: { owner: readOwner(path) } };
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
