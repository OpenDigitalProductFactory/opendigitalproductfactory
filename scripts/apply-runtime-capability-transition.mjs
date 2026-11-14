#!/usr/bin/env node
import { parseArgs as utilParseArgs } from "node:util";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateInstallState } from "./installer/validate-install-state.mjs";
import { canonicalTransitionPayload, signTransitionPayload, prepareRuntimeReconciliationIntent, validateRuntimeServiceImagePlan, validateRuntimeServiceImageProof } from "./lib/transition-signing.mjs";
import { inspectScopeEpochWriterImage, prepareRuntimeServiceImage } from "./promoter-epoch-evidence.mjs";
import { computeCapabilityStateVersion } from "./lib/capability-state-hash.mjs";

// Optional in N-1 minimum staging: absence disables image apply, while the
// original v1/v2 actuator remains loadable. Bind both owners before v3 IO.
function imageQualificationDigest() {
  try {
    return createHash("sha256").update(readFileSync(new URL("./promoter-epoch-evidence.mjs", import.meta.url)))
      .update("\0").update(readFileSync(new URL("./lib/git.mjs", import.meta.url))).digest("hex");
  } catch { return undefined; }
}

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
  const imageQualifierSha256 = imageQualificationDigest();
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    sourceSha: process.env.DPF_CANDIDATE_SOURCE_SHA ?? "unknown",
    signingVersions: [1, 2, 3], applyVersions: imageQualifierSha256 ? [1, 2, 3] : [1, 2], reconciliationVersions: imageQualifierSha256 ? [2, 3] : [2], imageReconciliationVersions: imageQualifierSha256 ? [3] : [],
    actuatorSha256: digest(new URL(import.meta.url)),
    signerSha256: digest(new URL("./lib/transition-signing.mjs", import.meta.url)),
    ...(imageQualifierSha256 ? { imageQualifierSha256 } : {}),
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
let secret = ""; let envelope; let imageProof;
const atomicJson = async (target, value) => {
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, target);
};
const writeReceipt = async (status, failure, observedServices = [], observedHealth = {}) => {
  if (!envelope || secret.length < 32) return;
  const unsigned = { ...envelope, status, observedServices: [...observedServices].sort(), observedHealth: Object.fromEntries(Object.entries(observedHealth).sort(([a], [b]) => a.localeCompare(b))), completedAt: new Date().toISOString(), beforeHash: envelope.previousStateHash, afterHash: status === "applied" ? envelope.desiredStateHash : envelope.previousStateHash, ...(imageProof ? { imageProof } : {}), ...(failure ? { failure } : {}) };
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
if (![1, 2, 3].includes(envelope.version) || argvId !== envelope.transitionId || !/^RCT-[A-Za-z0-9-]{1,48}$/.test(envelope.transitionId) || !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 30_000 || expires < now || expires - issued > 600_000) await fail("expired_or_invalid_envelope");
for (const k of ["catalogHash", "previousStateHash", "desiredStateHash"]) if (!/^[a-f0-9]{64}$/.test(envelope[k])) await fail("invalid_envelope_hash");
for (const k of ["previousKeys", "desiredKeys", "previousProfiles", "desiredProfiles", "previousServices", "desiredServices"]) if (!Array.isArray(envelope[k]) || JSON.stringify(envelope[k]) !== JSON.stringify([...new Set(envelope[k])].sort()) || envelope[k].some((x) => typeof x !== "string" || (k.endsWith("Keys") ? !/^runtime:[a-z0-9-]+$/.test(x) : !/^[a-z0-9][a-z0-9-]*$/.test(x)))) await fail("invalid_envelope_projection");
if (envelope.version >= 2 && envelope.mode === "reconciliation") {
  const identity = envelope.protocolIdentity;
  if (!identity || !/^[a-f0-9]{40}$/.test(identity.sourceSha ?? "") || !/^sha256:[a-f0-9]{64}$/.test(identity.promoterDigest ?? "")
    || identity.sourceSha !== process.env.DPF_CANDIDATE_SOURCE_SHA
    || identity.actuatorSha256 !== sha(await readFile(new URL(import.meta.url)))
    || identity.signerSha256 !== sha(await readFile(new URL("./lib/transition-signing.mjs", import.meta.url)))) await fail("runtime_protocol_identity_mismatch");
  if (envelope.version === 3 && (!imageQualificationDigest() || identity.imageQualifierSha256 !== imageQualificationDigest())) await fail("runtime_protocol_identity_mismatch");
}
if (envelope.version === 3) {
  try { validateRuntimeServiceImagePlan(envelope); } catch { await fail("runtime_image_plan_invalid"); }
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
// Keep the reconciliation host projection aligned with the server and canonical catalog
// resolver without importing bytes outside this actuator's signed closure.
const hostPlatform = envelope.version >= 2 && envelope.mode === "reconciliation"
  ? new Map([["win32", "windows"], ["darwin", "macos"], ["linux", "linux"]]).get(envelope.reconciliation?.observedHost?.platform)
  : undefined;
if (envelope.version >= 2 && envelope.mode === "reconciliation" && !hostPlatform) await fail("runtime_transition_host_platform_unverifiable");
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
if (envelope.version >= 2 && envelope.mode === "reconciliation") {
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
// Match govern-capability-compose-args.mountOverride without extending the
// signed actuator's dependency closure. Only bind overrides are persisted;
// rendered configuration may contain credentials and must never be logged.
let capturedImageConfiguration;
if (!(envelope.version === 3 && journal?.images)) try {
  const profiles = [...new Set([...previous.profiles, ...desired.profiles])].sort().flatMap(profile => ["--profile", profile]);
  const rendered = compose([...profiles, "config", "--format", "json"], 30_000);
  if (rendered.status !== 0) throw new Error();
  const mapStrings = (value, transform) => typeof value === "string" ? transform(value)
    : Array.isArray(value) ? value.map(entry => mapStrings(entry, transform))
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, transform)])) : value;
  const config = mapStrings(JSON.parse(rendered.stdout), value => value.replaceAll("$$", "$"));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error();
  const hasBinds = Object.values(config.services ?? {}).some(service => service.volumes?.some(volume => volume.type === "bind"));
  let mounts = [];
  if (hasBinds) {
    if (!process.env.HOSTNAME) throw new Error();
    const inspected = spawnSync(process.env.DPF_DOCKER_BIN ?? "docker", [...dockerPrefix, "inspect", process.env.HOSTNAME, "--format", "{{json .Mounts}}"], { encoding: "utf8", timeout: 30_000 });
    if (inspected.status !== 0) throw new Error();
    mounts = JSON.parse(inspected.stdout);
    if (!Array.isArray(mounts)) throw new Error();
  }
  const within = (path, root) => path === root || path.startsWith(`${root}/`);
  const trim = path => path.replace(/\/$/, "");
  const bindings = mounts.filter(mount => mount.Type === "bind")
    .map(mount => ({ ...mount, Destination: trim(mount.Destination) })).sort((a, b) => b.Destination.length - a.Destination.length);
  const root = trim(process.env.PROMOTE_SOURCE ?? "/host-source");
  const services = {};
  for (const [name, service] of Object.entries(config.services ?? {})) {
    const volumes = [];
    for (const volume of service.volumes ?? []) {
      if (volume.type !== "bind") continue;
      const binding = bindings.find(mount => within(volume.source, mount.Destination));
      if (binding) volumes.push(mapStrings({ ...volume, source: trim(binding.Source.replaceAll("\\", "/")) + volume.source.slice(binding.Destination.length) }, value => value.replaceAll("$", () => "$$")));
      else if (within(volume.source, root)) throw new Error();
    }
    if (volumes.length) services[name] = { volumes };
    if (envelope.version === 3 && volumes.length) {
      config.services[name].volumes = (service.volumes ?? []).map(volume => {
        const mapped = volumes.find(candidate => candidate.target === volume.target);
        return mapped ? mapStrings(mapped, value => value.replaceAll("$$", "$")) : volume;
      });
    }
  }
  if (envelope.version === 3) capturedImageConfiguration = mapStrings(config, value => value.replaceAll("$", () => "$$"));
  if (Object.keys(services).length) {
    const overridePath = join(receiptDir, `${envelope.transitionId}.compose-mounts.json`);
    await atomicJson(overridePath, { services });
    process.on("exit", () => { try { rmSync(overridePath); } catch {} });
    baseArgs.push("-f", overridePath);
  }
} catch { await fail("runtime_compose_mount_preflight_failed"); }
let scopeWriterOverride = null;
const reconcile = async (from, to) => {
  // Apply, journal resume and compensation all share this launch boundary.
  // Inspect the actual rendered image and pin its verified immutable bytes.
  try {
    const profiles = to.profiles.flatMap(profile => ["--profile", profile]);
    const rendered = compose([...profiles, "config", "--format", "json"], 30_000);
    if (rendered.status !== 0) throw new Error();
    const image = JSON.parse(rendered.stdout).services?.portal?.image;
    if (typeof image !== "string" || !image.trim()) throw new Error();
    const digest = await inspectScopeEpochWriterImage({ image, runDocker: async args => {
      const result = spawnSync(process.env.DPF_DOCKER_BIN ?? "docker", [...dockerPrefix, ...args],
        { encoding: "utf8", timeout: 60_000, maxBuffer: 8192 });
      if (result.status !== 0) throw new Error("scope_writer_probe_unavailable");
      return result.stdout;
    } });
    if (!scopeWriterOverride) {
      scopeWriterOverride = join(receiptDir, `${envelope.transitionId}.scope-writer.json`);
      baseArgs.push("-f", scopeWriterOverride);
      process.on("exit", () => { try { rmSync(scopeWriterOverride); } catch {} });
    }
    await atomicJson(scopeWriterOverride, { services: { portal: { image: digest, pull_policy: "never" } } });
  } catch { return { status: 78, stderr: "runtime_scope_writer_compatibility_unproven" }; }

  const disabled = from.required.filter((service) => !to.required.includes(service));
  if (disabled.length) { const stopped = compose(["stop", ...disabled]); if (stopped.status !== 0) return stopped; const removed = compose(["rm", "-f", ...disabled]); if (removed.status !== 0) return removed; }
  // Detached startup is not readiness. Bound each readiness wait, leaving room
  // for rollback; legacy stop/remove subprocesses retain their own timeouts.
  const args = []; for (const p of to.profiles) args.push("--profile", p); args.push("up", "-d", "--wait", "--wait-timeout", "180", ...to.required);
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

/** Image-only work uses the same signed journal and receipt, but never the
 * ordinary full-projection up. Unknown preparation/child outcomes are retained. */
async function reconcileSelectedImages() {
  const plan = validateRuntimeServiceImagePlan(envelope), selected = plan.services.map(entry => entry.service);
  const childBudget = 105_000, recoveryReserve = childBudget * 2 + 30_000;
  const needTime = reserve => { if (expires - Date.now() <= reserve) throw new Error("runtime_image_deadline_unavailable"); };
  const snapshotPath = join(receiptDir, `${envelope.transitionId}.image-baseline.json`);
  const targetPath = join(receiptDir, `${envelope.transitionId}.image-target.json`);
  const priorPath = join(receiptDir, `${envelope.transitionId}.image-prior.json`);
  const privatePaths = [snapshotPath, targetPath, priorPath];
  const docker = (args, options = {}) => spawnSync(process.env.DPF_DOCKER_BIN ?? "docker", [...dockerPrefix, ...args], {
    encoding: "utf8", timeout: options.timeoutMs ?? 30_000, maxBuffer: 2 * 1024 * 1024, input: options.input,
    env: { ...process.env, COMPOSE_REMOVE_ORPHANS: "false", COMPOSE_IGNORE_ORPHANS: "true" },
  });
  const settled = result => Number.isInteger(result.status) && !result.error && !result.signal;
  const readDocker = async (args, options) => {
    let bounded = options;
    if (["build", "pull"].includes(args[0])) {
      needTime(recoveryReserve + 1_000);
      bounded = { ...options, timeoutMs: Math.min(options?.timeoutMs ?? 300_000, expires - Date.now() - recoveryReserve) };
    }
    const result = docker(args, bounded);
    if (!settled(result) && ["build", "pull"].includes(args[0])) throw new Error("runtime_image_preparation_unsettled");
    if (!settled(result) || result.status !== 0) throw new Error("runtime_image_io_unverified");
    return result.stdout;
  };
  const frozen = (path, args, timeoutMs = 30_000) => docker(["compose", "--project-name", composeProject, "-f", path, ...args], { timeoutMs });
  const save = async images => {
    const { signature: _signature, ...unsigned } = journal;
    journal = { ...unsigned, images };
    journal.signature = createHmac("sha256", secret).update(JSON.stringify(stable(journal))).digest("hex");
    await atomicJson(journalPath, journal);
  };
  const inspectTemplate = '{"id":{{json .Id}},"imageId":{{json .Image}},"imageReference":{{json .Config.Image}},"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"recreateClass":{{json (index .Config.Labels "dpf.recreate-class")}},"configurationHash":{{json (index .Config.Labels "com.docker.compose.config-hash")}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}}}';
  const observeImages = async () => {
    const ids = String(await readDocker(["ps", "-a", "--filter", `label=com.docker.compose.project=${composeProject}`, "--no-trunc", "--format", "{{.ID}}"]))
      .trim().split(/\r?\n/).filter(Boolean);
    if (ids.length > 128 || new Set(ids).size !== ids.length || ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error("runtime_image_selection_unproven");
    const rows = {};
    for (const id of ids) {
      const bytes = await readDocker(["inspect", "--format", inspectTemplate, id]);
      if (Buffer.byteLength(bytes) > 64 * 1024) throw new Error("runtime_image_selection_unproven");
      const row = JSON.parse(bytes);
      if (row.id !== id || row.project !== composeProject) throw new Error("runtime_image_selection_unproven");
      if (!previous.required.includes(row.service)) continue;
      if (rows[row.service] || row.running !== true || !/^sha256:[a-f0-9]{64}$/.test(row.imageId ?? "")
        || !["healthy", "unhealthy", "starting", "none"].includes(row.health)) throw new Error("runtime_image_selection_unproven");
      row.mounts = (row.mounts ?? []).map(mount => Object.fromEntries(["Type", "Name", "Source", "Destination", "RW", "Propagation"].filter(key => mount[key] !== undefined).map(key => [key, mount[key]])))
        .sort((left, right) => String(left.Destination).localeCompare(String(right.Destination)));
      row.networks = Object.fromEntries(Object.entries(row.networks ?? {}).map(([name, network]) => [name, { NetworkID: network.NetworkID }]));
      rows[row.service] = row;
    }
    if (previous.required.some(service => !rows[service])) throw new Error("runtime_image_selection_unproven");
    return rows;
  };
  const health = rows => Object.fromEntries(Object.entries(rows).map(([service, row]) => [service, row.health]));
  const healthy = rows => exact(desired, Object.keys(rows), health(rows));
  const untouched = rows => Object.fromEntries(previous.required.filter(service => !selected.includes(service)).map(service => [service, rows[service].id]));
  const untouchedEqual = rows => sameInstallState(untouched(rows), untouched(journal.images.before));
  const resourceHash = row => sha(JSON.stringify(stable({ mounts: row.mounts, networks: row.networks })));
  const resourcesEqual = rows => selected.every(service => resourceHash(rows[service]) === resourceHash(journal.images.before[service]));
  const resultProof = rows => ({ schemaVersion: 1, sourceSha: plan.sourceSha,
    services: plan.services.map((entry, index) => ({ service: entry.service,
      priorImageId: journal.images.before[entry.service].imageId, intendedImageId: journal.images.prepared[index].imageId,
      observedImageId: rows[entry.service].imageId, priorContainerId: journal.images.before[entry.service].id,
      observedContainerId: rows[entry.service].id, resourcesBeforeHash: resourceHash(journal.images.before[entry.service]),
      resourcesAfterHash: resourceHash(rows[entry.service]), source: journal.images.prepared[index].source })),
    untouchedBefore: untouched(journal.images.before), untouchedAfter: untouched(rows) });
  const terminal = async (status, failure, rows) => {
    imageProof = undefined;
    if (rows && ["applied", "rolled_back"].includes(status)) {
      const candidate = resultProof(rows);
      validateRuntimeServiceImageProof({ status, observedHealth: health(rows), imageProof: candidate }, envelope);
      imageProof = candidate;
    }
    await writeReceipt(status, failure, rows ? Object.keys(rows) : [], rows ? health(rows) : {});
    if (status !== "rollback_failed") for (const path of privatePaths) await rm(path, { force: true });
    if (["applied", "rolled_back"].includes(status)) {
      await rm(journalPath, { force: true }); await rm(claim, { recursive: true, force: true });
    }
    if (status === "applied") { process.stdout.write(await readFile(receiptPath, "utf8")); return; }
    process.stderr.write(JSON.stringify({ status, failure }) + "\n"); process.exit(78);
  };
  const pinResources = (config, observed) => {
    const output = structuredClone(config), volumes = {}, networks = {};
    output.services = Object.fromEntries(selected.map(service => {
      const definition = structuredClone(config.services[service]);
      if (definition.network_mode || definition.ipc || definition.pid || definition.links?.length || definition.volumes_from?.length
        || definition.secrets?.length || definition.configs?.length) throw new Error("runtime_image_configuration_unverified");
      for (const volume of definition.volumes ?? []) if (volume.type === "volume") {
        const name = config.volumes?.[volume.source]?.name;
        if (typeof name !== "string" || !observed[service].mounts?.some(mount => mount.Type === "volume" && mount.Name === name && mount.Destination === volume.target)) throw new Error("runtime_image_configuration_unverified");
        volumes[volume.source] = { name, external: true };
      }
      const serviceNetworks = Object.keys(definition.networks ?? (config.networks?.default ? { default: {} } : {}));
      for (const network of serviceNetworks) {
        const name = config.networks?.[network]?.name;
        if (typeof name !== "string" || !/^[a-f0-9]{64}$/.test(observed[service].networks?.[name]?.NetworkID ?? "")) throw new Error("runtime_image_configuration_unverified");
        networks[network] = { name, external: true };
      }
      delete definition.build; delete definition.depends_on;
      definition.pull_policy = "never";
      return [service, definition];
    }));
    output.volumes = volumes; output.networks = networks;
    return output;
  };
  try {
    if (!sameInstallState(before, next)) throw new Error("runtime_image_plan_invalid");
    if (!journal.images) {
      needTime(recoveryReserve);
      const observed = await observeImages();
      for (const service of selected) {
        if (observed[service].recreateClass !== "stateless" || capturedImageConfiguration?.services?.[service]?.labels?.["dpf.recreate-class"] !== "stateless") throw new Error("runtime_image_selection_unproven");
      }
      if (previous.required.some(service => !selected.includes(service) && healthSemantics.get(service) === "compose-healthcheck" && observed[service].health !== "healthy")) throw new Error("runtime_image_health_unverified");
      pinResources(capturedImageConfiguration, observed);
      // A digest is not consent to apply unrelated configuration. Hash a fixed
      // resolved snapshot, accepting only its original or actual image spelling.
      await atomicJson(snapshotPath, capturedImageConfiguration);
      for (const service of selected) {
        const matches = path => {
          const result = frozen(path, ["config", "--hash", service]);
          const parts = String(result.stdout ?? "").trim().split(/\s+/);
          return settled(result) && result.status === 0 && parts.length === 2 && parts[0] === service
            && /^[a-f0-9]{64}$/.test(parts[1]) && parts[1] === observed[service].configurationHash;
        };
        if (!matches(snapshotPath)) {
          const reference = observed[service].imageReference;
          if (typeof reference !== "string" || !reference || reference.length > 512 || /\s/.test(reference)) throw new Error("runtime_image_configuration_unverified");
          capturedImageConfiguration.services[service].image = reference;
          await atomicJson(snapshotPath, capturedImageConfiguration);
          if (!matches(snapshotPath)) throw new Error("runtime_image_configuration_unverified");
        }
      }
      try { await inspectScopeEpochWriterImage({ image: observed.portal.imageId, runDocker: readDocker }); }
      catch { throw new Error("runtime_image_scope_writer_unproven"); }
      await save({ phase: "baseline", before: observed, configurationDigest: sha(await readFile(snapshotPath)) });
    }
    const images = journal.images;
    if (!images || !["baseline", "preparing", "prepared", "applying", "applied", "reverting", "reverted"].includes(images.phase)
      || !/^[a-f0-9]{64}$/.test(images.configurationDigest ?? "")) throw new Error("runtime_image_journal_invalid");
    const configurationBytes = await readFile(snapshotPath);
    if (configurationBytes.length > 2 * 1024 * 1024 || sha(configurationBytes) !== images.configurationDigest) throw new Error("runtime_image_journal_invalid");
    const configuration = JSON.parse(configurationBytes);
    if (images.phase === "preparing") return await terminal("rollback_failed", "runtime_image_preparation_unsettled");
    if (["applying", "reverting"].includes(images.phase)) return await terminal("rollback_failed", "runtime_image_apply_unsettled");
    if (images.phase === "baseline") {
      await save({ ...images, phase: "preparing" });
      if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "image-preparing") process.exit(86);
      const prepared = [];
      for (const entry of plan.services) {
        if (entry.source.kind === "restore" && images.before[entry.service].imageId !== entry.source.expectedImageId) throw new Error("runtime_image_ownership_changed");
        prepared.push(await prepareRuntimeServiceImage({ source: entry.source, sourceSha: plan.sourceSha, platform: plan.platform, stateDir: receiptDir,
          runDocker: readDocker, runGit: async args => {
            const { runGit } = await import("./lib/git.mjs");
            const result = runGit(args, { cwd: "/host-source", timeout: 30_000, maxBuffer: 64 * 1024 * 1024, binary: true });
            if (!result.ok) throw new Error("runtime_service_image_unproven");
            return result.stdout;
          } }));
      }
      await save({ ...journal.images, phase: "prepared", prepared });
      if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "image-prepared") process.exit(86);
    }
    if (!Array.isArray(journal.images.prepared) || journal.images.prepared.length !== selected.length
      || journal.images.prepared.some(entry => !/^sha256:[a-f0-9]{64}$/.test(entry.imageId ?? ""))) throw new Error("runtime_image_journal_invalid");
    const launch = async (path, targets) => {
      needTime(childBudget + 15_000);
      const config = pinResources(configuration, journal.images.before);
      for (const service of selected) config.services[service].image = targets[service];
      await atomicJson(path, config);
      return frozen(path, ["up", "-d", "--no-build", "--no-deps", "--pull", "never", "--wait", "--wait-timeout", "90", ...selected], childBudget);
    };
    let observed = await observeImages();
    if (!untouchedEqual(observed)) return await terminal("rollback_failed", "runtime_image_untouched_service_changed");
    if (!resourcesEqual(observed)) return await terminal("rollback_failed", "runtime_image_resources_changed");
    const targets = Object.fromEntries(selected.map((service, index) => [service, journal.images.prepared[index].imageId]));
    if (journal.images.phase === "prepared") {
      if (selected.some(service => observed[service].id !== journal.images.before[service].id || observed[service].imageId !== journal.images.before[service].imageId)) return await terminal("rollback_failed", "runtime_image_ownership_changed");
      for (const service of selected) if ((await readDocker(["image", "inspect", targets[service], "--format", "{{.Id}}"])).trim() !== targets[service]) throw new Error("runtime_service_image_unproven");
      if (selected.some(service => observed[service].imageId !== targets[service])) {
        needTime(recoveryReserve);
        // Record intent before IO and the actual normal child result after IO.
        // A crash in between is a hold, never an inferred successful child.
        await save({ ...journal.images, phase: "applying" });
        if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "image-applying") process.exit(86);
        const applied = await launch(targetPath, targets);
        if (!settled(applied)) return await terminal("rollback_failed", "runtime_image_apply_unsettled");
        await save({ ...journal.images, phase: "applied", applyExitCode: applied.status });
        if (["runtime-mutated", "image-applied"].includes(process.env.DPF_TEST_CRASH_AFTER_PHASE ?? "")) process.exit(86);
      } else await save({ ...journal.images, phase: "applied", applyExitCode: 0 });
      observed = await observeImages();
    }
    if (!untouchedEqual(observed)) return await terminal("rollback_failed", "runtime_image_untouched_service_changed");
    if (!resourcesEqual(observed)) return await terminal("rollback_failed", "runtime_image_resources_changed");
    if (journal.images.phase === "reverted") {
      if (!healthy(observed) || selected.some(service => observed[service].imageId !== journal.images.before[service].imageId)) return await terminal("rollback_failed", "runtime_image_restore_unverified");
      return await terminal("rolled_back", "runtime_image_health_failed_rolled_back", observed);
    }
    if (journal.images.phase !== "applied") throw new Error("runtime_image_journal_invalid");
    if (journal.images.applyExitCode === 0 && healthy(observed) && selected.every(service => observed[service].imageId === targets[service])) return await terminal("applied", undefined, observed);
    if (selected.some(service => ![targets[service], journal.images.before[service].imageId].includes(observed[service].imageId))) return await terminal("rollback_failed", "runtime_image_ownership_changed");
    const priorImages = Object.fromEntries(selected.map(service => [service, journal.images.before[service].imageId]));
    for (const image of Object.values(priorImages)) if ((await readDocker(["image", "inspect", image, "--format", "{{.Id}}"])).trim() !== image) return await terminal("rollback_failed", "runtime_image_prior_unavailable");
    await save({ ...journal.images, phase: "reverting" });
    const restored = await launch(priorPath, priorImages);
    if (!settled(restored)) return await terminal("rollback_failed", "runtime_image_restore_unsettled");
    await save({ ...journal.images, phase: "reverted", restoreExitCode: restored.status });
    if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "image-reverted") process.exit(86);
    observed = await observeImages();
    if (restored.status !== 0 || !untouchedEqual(observed) || !resourcesEqual(observed) || !healthy(observed) || selected.some(service => observed[service].imageId !== priorImages[service])) return await terminal("rollback_failed", "runtime_image_restore_unverified");
    return await terminal("rolled_back", "runtime_image_health_failed_rolled_back", observed);
  } catch (error) {
    const reason = typeof error?.message === "string" && /^runtime_(?:image|service_image)_[a-z_]+$/.test(error.message) ? error.message : "runtime_image_evidence_unavailable";
    return await terminal(reason === "runtime_image_preparation_unsettled" || ["applying", "applied", "reverting", "reverted"].includes(journal.images?.phase) ? "rollback_failed" : "failed", reason);
  }
}
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
if (envelope.version === 3) { await reconcileSelectedImages(); process.exit(0); }
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
  const rolled = await reconcile(desired, previous), observed = observe();
  await rm(claim, { recursive: true, force: true });
  const restored = rolled.status === 0 && observed.ps.status === 0 && exact(previous, observed.services, observed.health);
  if (restored) await rm(journalPath, { force: true });
  await fail(reason + (restored ? "_rolled_back" : "_rollback_failed"), restored ? "rolled_back" : "rollback_failed");
};
const applied = await reconcile(previous, desired);
if (applied.status !== 0) await rollbackOwnedInstallState("compose_reconcile_failed");
if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "runtime-mutated") process.exit(86);
if (journal.phase !== "runtime-reconciled") { const { signature: _stateSignature, ...stateJournal } = journal; journal = { ...stateJournal, phase: "runtime-reconciled" }; journal.signature = createHmac("sha256", secret).update(JSON.stringify(stable(journal))).digest("hex"); await atomicJson(journalPath, journal); }
if (process.env.DPF_TEST_CRASH_AFTER_PHASE === "runtime-reconciled") process.exit(86);
const { ps, services: observed, health: observedHealth } = observe();
if (ps.status !== 0 || !exact(desired, observed, observedHealth)) await rollbackOwnedInstallState("required_health_failed");
await assertOwnedInstallState();
await writeReceipt("applied", undefined, observed, observedHealth); await rm(journalPath, { force: true }); await rm(claim, { recursive: true, force: true }); process.stdout.write(await readFile(receiptPath, "utf8"));
