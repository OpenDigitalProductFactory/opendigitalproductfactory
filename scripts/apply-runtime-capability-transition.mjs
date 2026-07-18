#!/usr/bin/env node
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateInstallState } from "./installer/validate-install-state.mjs";

const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const canonical = (v) => JSON.stringify(v, Object.keys(v).sort());
const catalogBytes = (v) => `${JSON.stringify(stable(v), null, 2)}\n`;
const sha = (v) => createHash("sha256").update(v).digest("hex");
const sign = (v, secret) => createHmac("sha256", secret).update(canonical(v)).digest("hex");
const stateDir = process.env.DPF_STATE_DIR ?? "/dpf-state";
const receiptDir = join(stateDir, "runtime-capability-transitions");
const applyLock = join(stateDir, ".runtime-transition-apply.lock");
const rotationLock = join(stateDir, ".runtime-transition-secret.lock");
let secret = ""; let envelope;
const atomicJson = async (target, value) => {
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, target);
};
const writeReceipt = async (status, failure, observedServices = [], observedHealth = {}) => {
  if (!envelope || secret.length < 32) return;
  const unsigned = { ...envelope, status, observedServices: [...observedServices].sort(), observedHealth: Object.fromEntries(Object.entries(observedHealth).sort(([a], [b]) => a.localeCompare(b))), completedAt: new Date().toISOString(), beforeHash: envelope.previousStateHash, afterHash: status === "applied" ? envelope.desiredStateHash : envelope.previousStateHash, ...(failure ? { failure } : {}) };
  await mkdir(receiptDir, { recursive: true });
  const target = join(receiptDir, `${envelope.transitionId}.json`);
  await writeFile(`${target}.tmp`, JSON.stringify({ ...unsigned, signature: sign(unsigned, secret) }, null, 2) + "\n", { mode: 0o600 });
  await rename(`${target}.tmp`, target);
};
const fail = async (reason, status = "failed", code = 78) => { await writeReceipt(status, reason); process.stderr.write(JSON.stringify({ status, failure: reason }) + "\n"); process.exit(code); };
const contend = (reason) => { process.stderr.write(JSON.stringify({ status: "contended", failure: reason }) + "\n"); process.exit(75); };

const acquireApplyLock = () => {
  try { mkdirSync(applyLock); }
  catch {
    const expiresAt = Date.parse(readFileSync(join(applyLock, "expires-at"), "utf8").trim());
    if (!Number.isFinite(expiresAt) || expiresAt >= Date.now()) contend("transition_apply_in_progress");
    rmSync(applyLock, { recursive: true, force: true });
    try { mkdirSync(applyLock); } catch { contend("transition_apply_in_progress"); }
  }
  writeFileSync(join(applyLock, "expires-at"), new Date(Date.now() + 10 * 60_000).toISOString(), { flag: "wx", mode: 0o600 });
};
try { acquireApplyLock(); } catch { contend("invalid_transition_apply_lock"); }
process.on("exit", () => { try { rmSync(applyLock, { recursive: true, force: true }); } catch {} });
if (existsSync(rotationLock)) contend("transition_secret_rotation_in_progress");
const argvId = process.argv[2] === "--runtime-capability-transition" ? process.argv[3] : "";
try { secret = (await readFile(process.env.DPF_RUNTIME_TRANSITION_SECRET_FILE ?? "/run/secrets/dpf-runtime-transition", "utf8")).trim(); } catch { await fail("transition_secret_unreadable"); }
const encoded = process.env.DPF_RUNTIME_TRANSITION_ENVELOPE ?? "";
const signature = process.env.DPF_RUNTIME_TRANSITION_SIGNATURE ?? "";
if (secret.length < 32 || !encoded || !/^[a-f0-9]{64}$/.test(signature)) await fail("invalid_signed_envelope");
try { envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { await fail("invalid_signed_envelope"); }
const expected = sign(envelope, secret);
if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) await fail("tampered_envelope");
const issued = Date.parse(envelope.issuedAt), expires = Date.parse(envelope.expiresAt), now = Date.now();
if (envelope.version !== 1 || argvId !== envelope.transitionId || !/^RCT-[A-Za-z0-9-]{1,48}$/.test(envelope.transitionId) || !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 30_000 || expires < now || expires - issued > 600_000) await fail("expired_or_invalid_envelope");
for (const k of ["catalogHash", "previousStateHash", "desiredStateHash"]) if (!/^[a-f0-9]{64}$/.test(envelope[k])) await fail("invalid_envelope_hash");
for (const k of ["previousKeys", "desiredKeys", "previousProfiles", "desiredProfiles", "previousServices", "desiredServices"]) if (!Array.isArray(envelope[k]) || JSON.stringify(envelope[k]) !== JSON.stringify([...new Set(envelope[k])].sort()) || envelope[k].some((x) => typeof x !== "string" || (k.endsWith("Keys") ? !/^runtime:[a-z0-9-]+$/.test(x) : !/^[a-z0-9][a-z0-9-]*$/.test(x)))) await fail("invalid_envelope_projection");

await mkdir(receiptDir, { recursive: true });
const receiptPath = join(receiptDir, `${envelope.transitionId}.json`);
const journalPath = join(receiptDir, `${envelope.transitionId}.journal.json`);
try {
  const existing = JSON.parse(await readFile(receiptPath, "utf8")); const { signature: sig, ...unsigned } = existing;
  if (/^[a-f0-9]{64}$/.test(sig ?? "") && timingSafeEqual(Buffer.from(sig), Buffer.from(sign(unsigned, secret))) && canonical({ ...envelope }) === canonical(Object.fromEntries(Object.keys(envelope).map((k) => [k, existing[k]])))) { process.stdout.write(JSON.stringify(existing) + "\n"); process.exit(existing.status === "applied" ? 0 : 78); }
  await fail("replayed_transition_id");
} catch (e) { if (e?.code !== "ENOENT") await fail("invalid_existing_receipt"); }
const envelopeHash = sha(canonical(envelope));
let journal;
try {
  journal = JSON.parse(await readFile(journalPath, "utf8"));
  const { signature: journalSignature, ...unsignedJournal } = journal;
  if (!/^[a-f0-9]{64}$/.test(journalSignature ?? "") || !timingSafeEqual(Buffer.from(journalSignature), Buffer.from(createHmac("sha256", secret).update(JSON.stringify(stable(unsignedJournal))).digest("hex"))) || journal.version !== 1 || journal.transitionId !== envelope.transitionId || journal.envelopeHash !== envelopeHash || !["prepared", "state-written", "runtime-reconciled"].includes(journal.phase) || !journal.before || !journal.next) await fail("invalid_transition_journal");
} catch (error) {
  if (error?.code !== "ENOENT") await fail("invalid_transition_journal");
}
const claim = `${receiptPath}.claim`;
try { if (!journal) { await mkdir(claim); await writeFile(join(claim, "expires-at"), envelope.expiresAt, { flag: "wx", mode: 0o600 }); } } catch {
  try {
    const claimedUntil = Date.parse((await readFile(join(claim, "expires-at"), "utf8")).trim());
    if (!Number.isFinite(claimedUntil) || claimedUntil >= now) contend("transition_already_claimed");
    await rm(claim, { recursive: true, force: true }); await mkdir(claim); await writeFile(join(claim, "expires-at"), envelope.expiresAt, { flag: "wx", mode: 0o600 });
  } catch (error) { if (error?.code !== "ENOENT") contend("transition_already_claimed"); contend("invalid_transition_claim"); }
}

const catalogPath = process.env.DPF_CAPABILITY_CATALOG_PATH ?? "/host-source/scripts/capability-service-catalog.generated.json";
let catalog;
try { catalog = JSON.parse(await readFile(catalogPath, "utf8")); } catch { await fail("capability_catalog_unreadable"); }
const { catalogHash, ...catalogContent } = catalog;
if (catalogHash !== envelope.catalogHash || sha(catalogBytes(catalogContent)) !== catalogHash) await fail("capability_catalog_mismatch");
const byId = new Map(catalog.capabilities.map((c) => [c.capabilityId, c]));
const project = (keys) => { const enabled = new Set(); const add = (id) => { const c = byId.get(id); if (!c) throw new Error(`unknown_runtime_capability:${id}`); if (enabled.has(id)) return; for (const d of c.dependencies) add(d); enabled.add(id); }; for (const k of keys) add(k); for (const c of catalog.capabilities) if (c.activationPolicy === "always") add(c.capabilityId); const enabledKeys = [...enabled].sort(); const services = catalog.capabilities.filter((c) => enabled.has(c.capabilityId)).flatMap((c) => c.services).filter((s) => s.targetClassification !== "ephemeral-lifecycle"); return { enabledKeys, profiles: [...new Set(services.flatMap((s) => s.profiles))].sort(), required: [...new Set(services.map((s) => s.service))].sort(), stateHash: sha(`${catalogHash}\n${catalog.capabilities.map((c) => `${c.capabilityId}=${enabled.has(c.capabilityId) ? "active" : "disabled"}`).sort().join("\n")}`) }; };
let previous, desired; try { previous = project(envelope.previousKeys); desired = project(envelope.desiredKeys); } catch (e) { await fail(e.message); }
if (canonical(previous.enabledKeys) !== canonical(envelope.previousKeys) || canonical(desired.enabledKeys) !== canonical(envelope.desiredKeys) || canonical(previous.profiles) !== canonical(envelope.previousProfiles) || canonical(desired.profiles) !== canonical(envelope.desiredProfiles) || canonical(previous.required) !== canonical(envelope.previousServices) || canonical(desired.required) !== canonical(envelope.desiredServices) || previous.stateHash !== envelope.previousStateHash || desired.stateHash !== envelope.desiredStateHash) await fail("capability_projection_mismatch");

const statePath = join(stateDir, "install-state.json"); let before;
let currentState;
try { currentState = JSON.parse(await readFile(statePath, "utf8")); before = journal?.before ?? currentState; } catch { await fail("install_state_unreadable"); }
const schemaPath = process.env.DPF_INSTALL_STATE_SCHEMA_PATH;
let beforeValidation;
try { beforeValidation = await validateInstallState(before, schemaPath); } catch { await fail("install_state_schema_unreadable"); }
if (!beforeValidation.valid) await fail("install_state_schema_invalid");
if (before.capabilityCatalogHash !== envelope.catalogHash || before.capabilityStateVersion !== envelope.previousStateHash || canonical(before.enabledRuntimeCapabilities) !== canonical(envelope.previousKeys)) await fail("install_state_stale");
const files = String(process.env.PROMOTE_COMPOSE_FILES ?? "docker-compose.yml").split(/\s+/).filter(Boolean); const composeProject = process.env.PROMOTE_COMPOSE_PROJECT;
if (!composeProject || !/^[a-z0-9][a-z0-9_-]*$/.test(composeProject) || files.length === 0 || files.some((f) => !/^[A-Za-z0-9._-]+$/.test(f))) await fail("invalid_compose_configuration");
const baseArgs = ["compose", "--project-name", composeProject]; for (const f of files) baseArgs.push("-f", join("/host-source", f)); if (process.env.PROMOTE_COMPOSE_ENV_FILE) baseArgs.push("--env-file", process.env.PROMOTE_COMPOSE_ENV_FILE);
const dockerPrefix = process.env.DPF_DOCKER_PREFIX_ARGS ? JSON.parse(process.env.DPF_DOCKER_PREFIX_ARGS) : [];
if (!Array.isArray(dockerPrefix) || dockerPrefix.some((value) => typeof value !== "string")) await fail("invalid_docker_configuration");
const compose = (args, timeout = 9 * 60 * 1000) => spawnSync(process.env.DPF_DOCKER_BIN ?? "docker", [...dockerPrefix, ...baseArgs, ...args], { encoding: "utf8", timeout });
const reconcile = (from, to) => {
  const disabled = from.required.filter((service) => !to.required.includes(service));
  if (disabled.length) { const stopped = compose(["stop", ...disabled]); if (stopped.status !== 0) return stopped; const removed = compose(["rm", "-f", ...disabled]); if (removed.status !== 0) return removed; }
  const args = []; for (const p of to.profiles) args.push("--profile", p); args.push("up", "-d", ...to.required);
  return compose(args);
};
const observe = () => {
  const ps = compose(["ps", "--format", "json"], 30_000);
  try {
    const raw = String(ps.stdout ?? "").trim();
    const rows = !raw ? [] : raw.startsWith("[") ? JSON.parse(raw) : raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const health = Object.fromEntries(rows.map((row) => [row.Service, String(row.Health ?? "").toLowerCase() || "none"]));
    return { ps, services: rows.filter((row) => String(row.State ?? "").toLowerCase() === "running").map((row) => row.Service).sort(), health };
  } catch { return { ps: { ...ps, status: 1 }, services: [], health: {} }; }
};
const transitionServices = [...new Set([...envelope.previousServices, ...envelope.desiredServices])];
const healthSemantics = new Map(catalog.capabilities.flatMap((capability) => capability.services).map((service) => [service.service, service.healthSemantics]));
const exact = (projection, observed, health) => projection.required.every((service) => observed.includes(service) && (healthSemantics.get(service) !== "compose-healthcheck" || health[service] === "healthy")) && transitionServices.filter((service) => !projection.required.includes(service)).every((service) => !observed.includes(service));
const next = { ...before, enabledRuntimeCapabilities: desired.enabledKeys, capabilityCatalogHash: catalogHash, capabilityStateVersion: desired.stateHash };
const nextValidation = await validateInstallState(next, schemaPath);
if (!nextValidation.valid) await fail("install_state_schema_invalid");
if (journal && (canonical(journal.before) !== canonical(before) || canonical(journal.next) !== canonical(next))) await fail("invalid_transition_journal");
const currentIsBefore = canonical(currentState) === canonical(before);
const currentIsNext = canonical(currentState) === canonical(next);
if (!journal && !currentIsBefore) await fail("install_state_journal_mismatch");
if (journal?.phase === "prepared" && !currentIsBefore && !currentIsNext) await fail("install_state_journal_mismatch");
if (journal && journal.phase !== "prepared" && !currentIsNext) await fail("install_state_journal_mismatch");
if (!journal) {
  journal = { version: 1, transitionId: envelope.transitionId, envelopeHash, phase: "prepared", before, next };
  journal = { ...journal, signature: createHmac("sha256", secret).update(JSON.stringify(stable(journal))).digest("hex") };
  await atomicJson(journalPath, journal);
}
if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "prepared") process.exit(86);
if (journal.phase === "prepared") {
  if (!currentIsNext) await atomicJson(statePath, next);
  if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "state-mutated") process.exit(86);
  const { signature: _preparedSignature, ...preparedJournal } = journal;
  journal = { ...preparedJournal, phase: "state-written" };
  journal.signature = createHmac("sha256", secret).update(JSON.stringify(stable(journal))).digest("hex");
  await atomicJson(journalPath, journal);
  if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "state-written") process.exit(86);
}
const applied = reconcile(previous, desired);
if (applied.status !== 0) { await atomicJson(statePath, before); const rolled = reconcile(desired, previous); const rollbackObserved = observe(); await rm(claim, { recursive: true, force: true }); if (rolled.status === 0 && rollbackObserved.ps.status === 0 && exact(previous, rollbackObserved.services, rollbackObserved.health)) await rm(journalPath, { force: true }); await fail(rolled.status === 0 && rollbackObserved.ps.status === 0 && exact(previous, rollbackObserved.services, rollbackObserved.health) ? "compose_reconcile_failed_rolled_back" : "compose_reconcile_failed_rollback_failed", rolled.status === 0 && rollbackObserved.ps.status === 0 && exact(previous, rollbackObserved.services, rollbackObserved.health) ? "rolled_back" : "rollback_failed"); }
if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "runtime-mutated") process.exit(86);
if (journal.phase !== "runtime-reconciled") { const { signature: _stateSignature, ...stateJournal } = journal; journal = { ...stateJournal, phase: "runtime-reconciled" }; journal.signature = createHmac("sha256", secret).update(JSON.stringify(stable(journal))).digest("hex"); await atomicJson(journalPath, journal); }
if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "runtime-reconciled") process.exit(86);
const { ps, services: observed, health: observedHealth } = observe();
if (ps.status !== 0 || !exact(desired, observed, observedHealth)) { await atomicJson(statePath, before); const rolled = reconcile(desired, previous); const rollbackObserved = observe(); await rm(claim, { recursive: true, force: true }); if (rolled.status === 0 && rollbackObserved.ps.status === 0 && exact(previous, rollbackObserved.services, rollbackObserved.health)) await rm(journalPath, { force: true }); await fail(rolled.status === 0 && rollbackObserved.ps.status === 0 && exact(previous, rollbackObserved.services, rollbackObserved.health) ? "required_health_failed_rolled_back" : "required_health_failed_rollback_failed", rolled.status === 0 && rollbackObserved.ps.status === 0 && exact(previous, rollbackObserved.services, rollbackObserved.health) ? "rolled_back" : "rollback_failed"); }
await writeReceipt("applied", undefined, observed, observedHealth); await rm(journalPath, { force: true }); await rm(claim, { recursive: true, force: true }); process.stdout.write(await readFile(receiptPath, "utf8"));
