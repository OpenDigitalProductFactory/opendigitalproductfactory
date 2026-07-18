#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, open, readFile, readdir, rename, rm, lstat, realpath } from "node:fs/promises";
import contract from "./install-state-lock-contract.json" with { type: "json" };
import { parseAndValidateInstallStateBytes, validateInstallState } from "./validate-install-state.mjs";

const PROTOCOL_VERSION = contract.protocolVersion;
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const localHostname = hostname();
const makeOwner = (ownerId, runId, leaseMs) => { const now = Date.now(); return { protocolVersion: PROTOCOL_VERSION, ownerId, runId, pid: process.pid, hostname: localHostname, acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + leaseMs).toISOString(), expiresAtEpoch: Math.ceil((now + leaseMs) / 1000) }; };

const pidIsLive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
};

async function assertSafeTarget(statePath) {
  const absolute = resolve(statePath);
  const parent = dirname(absolute);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const canonicalParent = await realpath(parent);
  if (dirname(absolute) !== canonicalParent && process.platform !== "win32") throw new Error("state_path_escape");
  try { if ((await lstat(absolute)).isSymbolicLink()) throw new Error("state_path_symlink"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  return absolute;
}

async function staleOwner(lockPath, now) {
  let owner;
  try { owner = JSON.parse(await readFile(lockPath, "utf8")); } catch { return false; }
  if (owner.protocolVersion !== PROTOCOL_VERSION || !owner.ownerId || !Number.isSafeInteger(owner.expiresAtEpoch)) return false;
  if (owner.expiresAtEpoch * 1000 > now) return false;
  if (owner.hostname === localHostname && pidIsLive(owner.pid)) return false;
  return true;
}

async function readOwner(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; } }

async function activeReclaimGuards(lockPath) {
  const directory = dirname(lockPath); const prefix = `${basename(lockPath)}${contract.reclaimSuffix}`; const active = [];
  for (const name of await readdir(directory)) {
    if (!name.startsWith(prefix)) continue; const path = join(directory, name); const guard = await readOwner(path); if (!guard) continue;
    if ((Number.isSafeInteger(guard.expiresAtEpoch) && guard.expiresAtEpoch * 1000 > Date.now()) || (guard.hostname === localHostname && pidIsLive(guard.pid))) { active.push({ path, owner: guard }); continue; }
    const current = await readOwner(lockPath);
    if (current?.ownerId === guard.targetOwnerId) { const quarantine = `${lockPath}.stale-${randomUUID()}`; try { await rename(lockPath, quarantine); await rm(quarantine, { force: true }); } catch {} }
    const after = await readOwner(lockPath); if (after?.ownerId !== guard.targetOwnerId) await rm(path, { force: true }); else active.push({ path, owner: guard });
  }
  return active;
}

async function acquireReclaimGuard(lockPath, staleOwnerId, options, deadline) {
  const ownerId = options.reclaimOwnerId ?? randomUUID(); const generation = sha256(staleOwnerId).slice(0, 24); const path = `${lockPath}${contract.reclaimSuffix}${generation}`; const runId = options.runId ?? process.env.DPF_RUN_ID ?? randomUUID();
  for (;;) {
    try {
      const handle = await open(path, "wx", 0o600); const owner = { ...makeOwner(ownerId, runId, options.reclaimLeaseMs ?? 5000), targetOwnerId: staleOwnerId };
      try { await handle.writeFile(`${JSON.stringify(owner)}\n`); await handle.sync(); } finally { await handle.close(); }
      await options.onReclaimElected?.();
      return async () => { await rm(path, { force: true }); };
    } catch (error) { if (error?.code !== "EEXIST") throw error; }
    await activeReclaimGuards(lockPath);
    if (Date.now() >= deadline) throw new Error("install_state_lock_timeout");
    await sleep(options.retryDelayMs ?? contract.retryDelayMs);
  }
}

export async function acquireInstallStateLock(statePath, options = {}) {
  const target = await assertSafeTarget(statePath);
  const lockPath = `${target}.lock`;
  const timeoutMs = options.timeoutMs ?? contract.defaultTimeoutMs;
  const leaseMs = options.leaseMs ?? contract.defaultLeaseMs;
  const deadline = Date.now() + timeoutMs;
  const ownerId = randomUUID();
  const runId = options.runId ?? process.env.DPF_RUN_ID ?? randomUUID();
  const ownerPath = lockPath;
  for (;;) {
    try {
      if ((await activeReclaimGuards(lockPath)).length) { if (Date.now() >= deadline) throw new Error("install_state_lock_timeout"); await sleep(options.retryDelayMs ?? contract.retryDelayMs); continue; }
      const owner = makeOwner(ownerId, runId, leaseMs);
      const handle = await open(ownerPath, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      if ((await activeReclaimGuards(lockPath)).length) { await rm(ownerPath, { force: true }); continue; }
      return { lockPath, owner, async release() {
        let current;
        try { current = JSON.parse(await readFile(ownerPath, "utf8")); } catch { return; }
        if (current.ownerId === ownerId) await rm(ownerPath, { force: true });
      }};
    } catch (error) {
      if (error?.code !== "EEXIST") {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (await staleOwner(lockPath, Date.now())) {
        await options.onStaleObserved?.();
        const stale = await readOwner(lockPath); if (!stale) continue;
        const releaseReclaim = await acquireReclaimGuard(lockPath, stale.ownerId, options, deadline);
        try {
          const current = await readOwner(lockPath);
          if (current?.ownerId === stale.ownerId && await staleOwner(lockPath, Date.now())) { const quarantine = `${lockPath}.stale-${randomUUID()}`; try { await rename(ownerPath, quarantine); await rm(quarantine, { force: true }); } catch (recoveryError) { if (!["ENOENT", "EEXIST"].includes(recoveryError?.code)) throw recoveryError; } }
          else if (current?.ownerId && current.ownerId !== stale.ownerId) await options.onGenerationMismatch?.(current.ownerId);
        }
        finally { await releaseReclaim(); }
        continue;
      }
      if (Date.now() >= deadline) throw new Error("install_state_lock_timeout");
      await sleep(options.retryDelayMs ?? contract.retryDelayMs);
    }
  }
}

const stage = async (name, context, options) => {
  await options.onStage?.(name, context);
  if (options.crashAfterStage === name) {
    if (context.lockPath) {
      const ownerPath = context.lockPath;
      try { const owner = JSON.parse(await readFile(ownerPath, "utf8")); owner.pid = 99999999; owner.expiresAt = "2000-01-01T00:00:00.000Z"; owner.expiresAtEpoch = 946684800; const h = await open(ownerPath, "w"); try { await h.writeFile(JSON.stringify(owner)); await h.sync(); } finally { await h.close(); } } catch {}
    }
    throw new Error(`injected_crash:${name}`);
  }
};

async function removeOrphanTemps(target) {
  const prefix = `.${basename(target)}.tmp-`;
  for (const name of await readdir(dirname(target))) if (name.startsWith(prefix)) await rm(join(dirname(target), name), { force: true });
}

async function atomicReplace(tempPath, target) {
  const deadline = Date.now() + 2000;
  for (;;) {
    try { await rename(tempPath, target); return; }
    catch (error) {
      if (!["EACCES", "EPERM", "EBUSY"].includes(error?.code) || Date.now() >= deadline) throw error;
      await sleep(10);
    }
  }
}

async function flushParentDirectory(target) {
  if (process.platform === "win32") return;
  const directory = await open(dirname(target), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

async function writeFlushed(path, bytes) {
  const handle = await open(path, "w", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

async function reconcileCanonical(target, recoveryPath) {
  let canonical;
  try { canonical = await readFile(target); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (canonical && (await parseAndValidateInstallStateBytes(canonical)).valid) return;
  let recovery;
  try { recovery = await readFile(recoveryPath); } catch (error) { if (error?.code === "ENOENT" && !canonical) return; throw new Error("install_state_recovery_missing_or_invalid"); }
  if (!(await parseAndValidateInstallStateBytes(recovery)).valid) throw new Error("install_state_recovery_missing_or_invalid");
  const restoreTemp = `${target}.restore-${randomUUID()}`;
  await writeFlushed(restoreTemp, recovery);
  await atomicReplace(restoreTemp, target);
  await flushParentDirectory(target);
}

export async function updateInstallState(statePath, transform, options = {}) {
  const target = await assertSafeTarget(statePath);
  const lock = await acquireInstallStateLock(target, options);
  let release = true;
  const context = { statePath: target, lockPath: lock.lockPath };
  const recoveryPath = options.recoveryPath ?? null;
  try {
    await stage("locked", context, options);
    if (recoveryPath) await reconcileCanonical(target, recoveryPath);
    await removeOrphanTemps(target);
    let source = null;
    try { source = await readFile(target); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    const sourceSha = source === null ? null : sha256(source);
    if (Object.hasOwn(options, "expectedSourceSha256") && options.expectedSourceSha256 !== sourceSha) throw new Error("install_state_cas_mismatch");
    const current = source === null ? null : JSON.parse(source.toString("utf8").replace(/^\uFEFF/, ""));
    const next = await transform(current);
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    JSON.parse(serialized);
    const validation = await validateInstallState(next, options.schemaPath);
    if (!validation.valid) throw new Error(`install_state_schema_validation_failed:${validation.errors.join(",")}`);
    const tempPath = join(dirname(target), `.${basename(target)}.tmp-${lock.owner.ownerId}`);
    context.tempPath = tempPath;
    const handle = await open(tempPath, "wx", 0o600);
    try { await stage("temp-created", context, options); await handle.writeFile(serialized, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await stage("temp-flushed", context, options);
    if (source !== null && recoveryPath) {
      context.recoveryPath = recoveryPath;
      await writeFlushed(recoveryPath, source);
      await stage("recovery-flushed", context, options);
    }
    await atomicReplace(tempPath, target);
    await flushParentDirectory(target);
    await stage("replaced", context, options);
    const durable = await readFile(target);
    const parsed = JSON.parse(durable.toString("utf8"));
    if (sha256(durable) !== sha256(Buffer.from(serialized))) throw new Error("install_state_post_write_mismatch");
    const postValidation = await parseAndValidateInstallStateBytes(durable);
    if (!postValidation.valid) throw new Error("install_state_post_write_schema_validation_failed");
    await stage("verified", context, options);
    return { state: parsed, sourceSha256: sourceSha, writtenSha256: sha256(durable) };
  } catch (error) {
    if (String(error?.message).startsWith("injected_crash:")) release = false;
    throw error;
  } finally {
    if (release) { if (context.tempPath) await rm(context.tempPath, { force: true }); await lock.release(); }
  }
}

function parseArgs(argv) { const result = { _: [] }; for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith("--")) result[argv[i].slice(2)] = argv[++i]; else result._.push(argv[i]); } return result; }
async function main() {
  const args = parseArgs(process.argv.slice(2)); const command = args._[0];
  if (!args.state) throw new Error("--state is required");
  if (command === "set") await updateInstallState(args.state, current => ({ ...(current ?? {}), [args.key]: JSON.parse(args.value) }));
  else if (command === "init") await updateInstallState(args.state, current => current ?? JSON.parse(Buffer.from(args.value, "base64url").toString("utf8")));
  else throw new Error("command must be set or init");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
