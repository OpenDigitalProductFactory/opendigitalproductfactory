#!/usr/bin/env node
import { parseArgs as utilParseArgs } from "node:util";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateInstallState } from "./installer/validate-install-state.mjs";
import { canonicalTransitionPayload, signTransitionPayload, prepareRuntimeReconciliationIntent } from "./lib/transition-signing.mjs";
import { computeCapabilityStateVersion } from "./lib/capability-state-hash.mjs";

// strict: false keeps the old tolerance for flags this script does not read.
const { values: flags } = utilParseArgs({ args: process.argv.slice(2), strict: false, allowPositionals: true, options: { "state-dir": { type: "string" }, "runtime-capability-protocol-info": { type: "boolean" } } });

// Packaged-actuator discovery must precede locks, secret reads and journals.
// Signing v2 support does not imply v2 apply or reconciliation support.
if (flags["runtime-capability-protocol-info"]) {
  if (process.argv.length !== 3) {
    process.stderr.write("invalid_runtime_protocol_probe_arguments\n");
    process.exit(64);
  }
  const digest = (url) => createHash("sha256").update(readFileSync(url)).digest("hex");
  let validatedSnapshotSha256;
  if (process.env.DPF_RUNTIME_VALIDATE_SNAPSHOT !== undefined) {
    const encoded = process.env.DPF_RUNTIME_VALIDATE_SNAPSHOT;
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 64 * 1024) throw new Error();
      const bytes = Buffer.from(encoded, "base64url");
      if (!(await validateInstallState(JSON.parse(bytes.toString("utf8")))).valid) throw new Error();
      validatedSnapshotSha256 = createHash("sha256").update(bytes).digest("hex");
    } catch { process.stderr.write("runtime_protocol_snapshot_invalid\n"); process.exit(78); }
  }
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    sourceSha: process.env.DPF_CANDIDATE_SOURCE_SHA ?? "unknown",
    signingVersions: [1, 2], applyVersions: [1, 2], reconciliationVersions: [2],
    actuatorSha256: digest(new URL(import.meta.url)),
    signerSha256: digest(new URL("./lib/transition-signing.mjs", import.meta.url)),
    ...(validatedSnapshotSha256 ? { validatedSnapshotSha256 } : {}),
  }) + "\n");
  process.exit(0);
}

const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const sameInstallState = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const canonical = canonicalTransitionPayload;
const catalogBytes = (v) => `${JSON.stringify(stable(v), null, 2)}\n`;
const sha = (v) => createHash("sha256").update(v).digest("hex");
const sign = signTransitionPayload;
const stateDir = flags["state-dir"] === undefined ? (process.env.DPF_PROMOTER_STATE_DIR ?? "/dpf-state") : typeof flags["state-dir"] === "string" ? flags["state-dir"] : undefined;
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
  catch (error) {
    // Legacy locks carry no process-start or descendant settlement evidence.
    // Expiry is a deadline, never proof that the previous writer stopped.
    if (error.code === "EEXIST") contend("transition_apply_in_progress");
    throw error;
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
if (envelope.version === 2 && envelope.mode !== "transition"
  && !(envelope.mode === "reconciliation" && envelope.reconciliation)) await fail("unsupported_runtime_transition_mode");
if (![1, 2].includes(envelope.version) || argvId !== envelope.transitionId || !/^RCT-[A-Za-z0-9-]{1,48}$/.test(envelope.transitionId) || !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 30_000 || expires < now || expires - issued > 600_000) await fail("expired_or_invalid_envelope");
for (const k of ["catalogHash", "previousStateHash", "desiredStateHash"]) if (!/^[a-f0-9]{64}$/.test(envelope[k])) await fail("invalid_envelope_hash");
for (const k of ["previousKeys", "desiredKeys", "previousProfiles", "desiredProfiles", "previousServices", "desiredServices"]) if (!Array.isArray(envelope[k]) || JSON.stringify(envelope[k]) !== JSON.stringify([...new Set(envelope[k])].sort()) || envelope[k].some((x) => typeof x !== "string" || (k.endsWith("Keys") ? !/^runtime:[a-z0-9-]+$/.test(x) : !/^[a-z0-9][a-z0-9-]*$/.test(x)))) await fail("invalid_envelope_projection");
if (envelope.version === 2 && envelope.mode === "reconciliation") {
  const identity = envelope.protocolIdentity;
  if (!identity || !/^[a-f0-9]{40}$/.test(identity.sourceSha ?? "") || !/^sha256:[a-f0-9]{64}$/.test(identity.promoterDigest ?? "")
    || identity.sourceSha !== process.env.DPF_CANDIDATE_SOURCE_SHA
    || identity.actuatorSha256 !== sha(await readFile(new URL(import.meta.url)))
    || identity.signerSha256 !== sha(await readFile(new URL("./lib/transition-signing.mjs", import.meta.url)))) await fail("runtime_protocol_identity_mismatch");
}

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

const catalogPath = process.env.DPF_CAPABILITY_CATALOG_PATH ?? new URL("./capability-service-catalog.generated.json", import.meta.url);
let catalog;
try { catalog = JSON.parse(await readFile(catalogPath, "utf8")); } catch { await fail("capability_catalog_unreadable"); }
const { catalogHash, ...catalogContent } = catalog;
if (catalogHash !== envelope.catalogHash || sha(catalogBytes(catalogContent)) !== catalogHash) await fail("capability_catalog_mismatch");
const byId = new Map(catalog.capabilities.map((c) => [c.capabilityId, c]));
// Keep the v2 host projection aligned with the server and canonical catalog
// resolver without importing bytes outside this actuator's signed closure.
const hostPlatform = envelope.version === 2 && envelope.mode === "reconciliation"
  ? new Map([["win32", "windows"], ["darwin", "macos"], ["linux", "linux"]]).get(envelope.reconciliation?.observedHost?.platform)
  : undefined;
if (envelope.version === 2 && envelope.mode === "reconciliation" && !hostPlatform) await fail("runtime_transition_host_platform_unverifiable");
const project = (keys) => {
  const enabled = new Set();
  const add = (id) => {
    const capability = byId.get(id);
    if (!capability) throw new Error(`unknown_runtime_capability:${id}`);
    if (enabled.has(id)) return;
    for (const dependency of capability.dependencies) add(dependency);
    enabled.add(id);
  };
  for (const key of keys) add(key);
  for (const capability of catalog.capabilities) if (capability.activationPolicy === "always") add(capability.capabilityId);
  const enabledKeys = [...enabled].sort();
  const services = catalog.capabilities.filter((capability) => enabled.has(capability.capabilityId))
    .flatMap((capability) => capability.services)
    .filter((service) => service.targetClassification !== "ephemeral-lifecycle" && (!hostPlatform || service.hostPlatforms.includes(hostPlatform)));
  return {
    enabledKeys,
    profiles: [...new Set(services.flatMap((service) => service.profiles))].sort(),
    required: [...new Set(services.map((service) => service.service))].sort(),
    stateHash: computeCapabilityStateVersion(catalogHash, enabledKeys, catalog.capabilities.map((capability) => capability.capabilityId)),
  };
};
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
if (envelope.version === 2 && envelope.mode === "reconciliation") {
  let intent;
  try { intent = prepareRuntimeReconciliationIntent(envelope.reconciliation, {
    catalogHash, capabilityIds: catalog.capabilities.map(capability => capability.capabilityId),
  }); } catch (error) { await fail(error.message); }
  if (!sameInstallState(intent.observedHost, before)) await fail("reconciliation_host_identity_mismatch");
  if (canonical(intent.observedHost.enabledRuntimeCapabilities) !== canonical(envelope.previousKeys)
    || canonical(intent.desiredHostEnabledKeys) !== canonical(envelope.desiredKeys)) await fail("reconciliation_projection_mismatch");
}
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
// BI-28D2919A: a portal change to an operator-decided capability is the
// operator's decision; record it so the install stops reading as "undecided".
// Inlined, not imported from lib/resolve-capability-compose-profiles.mjs: the
// signed protocol identity hashes only this file and transition-signing.mjs,
// so an extra import would extend the trusted closure outside that identity.
// Keep in step with OPERATOR_DECIDED_CAPABILITIES there.
const OPERATOR_DECIDED_CAPABILITIES = ["runtime:deep-observability"];
// decidedAt is the SIGNED issuedAt, never the wall clock: crash replay
// recomputes `next` and must equal the journaled one byte for byte.
const decidedAt = new Date(issued).toISOString();
const decidedKeys = before.schemaVersion !== 2 ? [] : OPERATOR_DECIDED_CAPABILITIES.filter((key) =>
  (envelope.version === 2 && envelope.mode === "reconciliation" && envelope.reconciliation.touchedKeys.includes(key))
  || envelope.previousKeys.includes(key) !== envelope.desiredKeys.includes(key));
const next = { ...before, enabledRuntimeCapabilities: desired.enabledKeys, capabilityCatalogHash: catalogHash, capabilityStateVersion: desired.stateHash,
  ...(decidedKeys.length ? { runtimeCapabilityDecisions: { ...(before.runtimeCapabilityDecisions ?? {}), ...Object.fromEntries(decidedKeys.map((key) =>
    [key, { decision: desired.enabledKeys.includes(key) ? "enabled" : "disabled", source: "portal", decidedAt }])) } } : {}) };
const nextValidation = await validateInstallState(next, schemaPath);
if (!nextValidation.valid) await fail("install_state_schema_invalid");
if (journal && (!sameInstallState(journal.before, before) || !sameInstallState(journal.next, next))) await fail("invalid_transition_journal");
const currentIsBefore = sameInstallState(currentState, before);
const currentIsNext = sameInstallState(currentState, next);
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
  if (["state-mutated", "install-state-renamed-before-journal"].includes(process.env.DPF_TEST_CRASH_AFTER_PHASE ?? "")) process.exit(86);
  const { signature: _preparedSignature, ...preparedJournal } = journal;
  journal = { ...preparedJournal, phase: "state-written" };
  journal.signature = createHmac("sha256", secret).update(JSON.stringify(stable(journal))).digest("hex");
  await atomicJson(journalPath, journal);
  if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "state-written") process.exit(86);
}
const assertOwnedInstallState = async () => {
  let owned;
  try { owned = JSON.parse(await readFile(statePath, "utf8")); } catch { await fail("install_state_ownership_changed", "rollback_failed"); }
  if (!sameInstallState(owned, next)) await fail("install_state_ownership_changed", "rollback_failed");
};
const rollbackOwnedInstallState = async (reason) => {
  await assertOwnedInstallState();
  await atomicJson(statePath, before);
  const rolled = reconcile(desired, previous), observed = observe();
  await rm(claim, { recursive: true, force: true });
  const restored = rolled.status === 0 && observed.ps.status === 0 && exact(previous, observed.services, observed.health);
  if (restored) await rm(journalPath, { force: true });
  await fail(reason + (restored ? "_rolled_back" : "_rollback_failed"), restored ? "rolled_back" : "rollback_failed");
};
const applied = reconcile(previous, desired);
if (applied.status !== 0) await rollbackOwnedInstallState("compose_reconcile_failed");
if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "runtime-mutated") process.exit(86);
if (journal.phase !== "runtime-reconciled") { const { signature: _stateSignature, ...stateJournal } = journal; journal = { ...stateJournal, phase: "runtime-reconciled" }; journal.signature = createHmac("sha256", secret).update(JSON.stringify(stable(journal))).digest("hex"); await atomicJson(journalPath, journal); }
if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "runtime-reconciled") process.exit(86);
const { ps, services: observed, health: observedHealth } = observe();
if (ps.status !== 0 || !exact(desired, observed, observedHealth)) await rollbackOwnedInstallState("required_health_failed");
await assertOwnedInstallState();
await writeReceipt("applied", undefined, observed, observedHealth); await rm(journalPath, { force: true }); await rm(claim, { recursive: true, force: true }); process.stdout.write(await readFile(receiptPath, "utf8"));
