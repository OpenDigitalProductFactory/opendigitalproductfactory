#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const [operation, transitionId, suppliedToken] = process.argv.slice(2);
const validId = /^RCT-[A-Za-z0-9-]{1,48}$/;
if (!["reserve", "release", "reconcile"].includes(operation) || (operation !== "reconcile" && !validId.test(transitionId ?? ""))) {
  process.stderr.write("invalid_runtime_transition_authority_request\n"); process.exit(64);
}
const stateDirFlag = process.argv.indexOf("--state-dir");
const stateDir = resolve(stateDirFlag >= 0 ? process.argv[stateDirFlag + 1] : (process.env.DPF_PROMOTER_STATE_DIR ?? "."));
const marker = join(stateDir, "runtime-transition-authority.json");
const leaseMs = Number(process.env.DPF_RUNTIME_TRANSITION_AUTHORITY_LEASE_MS ?? 600_000);
if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 3_600_000) { process.stderr.write("invalid_authority_lease_duration\n"); process.exit(64); }
await mkdir(stateDir, { recursive: true, mode: 0o700 });

const readMarker = async () => {
  try { return JSON.parse(await readFile(marker, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
const activeIds = new Set((process.env.DPF_ACTIVE_RUNTIME_TRANSITION_IDS ?? "").split(",").filter(Boolean));
const now = process.env.DPF_TEST_NOW_MS ? Number(process.env.DPF_TEST_NOW_MS) : Date.now();
if (!Number.isFinite(now)) { process.stderr.write("invalid_authority_clock\n"); process.exit(64); }

if (operation === "reserve") {
  const token = randomBytes(32).toString("hex");
  const lease = { version: 1, transitionId, ownershipToken: token, acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + leaseMs).toISOString(), boundToDb: false };
  try {
    const file = await open(marker, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(lease)}\n`); } finally { await file.close(); }
  } catch (error) {
    // EEXIST never proves ownership, including when the caller reused an id.
    if (error.code !== "EEXIST") throw error;
    process.stderr.write("transition_authority_in_use\n"); process.exit(75);
  }
  process.stdout.write(`${JSON.stringify({ status: "reserved", transitionId, ownershipToken: token, expiresAt: lease.expiresAt })}\n`);
} else if (operation === "release") {
  const lease = await readMarker();
  if (!lease || lease.transitionId !== transitionId || typeof suppliedToken !== "string" || suppliedToken.length !== 64 || lease.ownershipToken !== suppliedToken) {
    process.stderr.write("transition_authority_not_owned\n"); process.exit(75);
  }
  await rm(marker);
  process.stdout.write(`${JSON.stringify({ status: "released", transitionId })}\n`);
} else {
  const lease = await readMarker();
  if (!lease) { process.stdout.write('{"status":"clear"}\n'); }
  else if (activeIds.has(lease.transitionId)) {
    // Bind the marker to durable DB truth and renew it for startup recovery.
    const bound = { ...lease, boundToDb: true, expiresAt: new Date(now + leaseMs).toISOString() };
    await import("node:fs/promises").then(({ writeFile }) => writeFile(marker, `${JSON.stringify(bound)}\n`, { mode: 0o600 }));
    process.stdout.write(`${JSON.stringify({ status: "bound", transitionId: lease.transitionId, expiresAt: bound.expiresAt })}\n`);
  } else if (lease.boundToDb === true || (Number.isFinite(Date.parse(lease.expiresAt)) && Date.parse(lease.expiresAt) <= now)) {
    // Only startup reconciliation, after its DB cross-check, may reap an orphan.
    await rm(marker);
    process.stdout.write(`${JSON.stringify({ status: "recovered", transitionId: lease.transitionId })}\n`);
  } else {
    process.stderr.write("transition_authority_in_use\n"); process.exit(75);
  }
}
