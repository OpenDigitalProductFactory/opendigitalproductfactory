import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { signTransitionPayload, verifyTransitionSignature } from "./lib/transition-signing.mjs";

const script = fileURLToPath(new URL("./apply-runtime-capability-transition.mjs", import.meta.url)).replace(/^\/(.:\/)/, "$1");
const canonical = (v) => JSON.stringify(v, Object.keys(v).sort());
const secret = "s".repeat(32);
function envelope(now = Date.now()) { return { version: 1, transitionId: "RCT-test", issuedAt: new Date(now - 100).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), catalogHash: "a".repeat(64), previousStateHash: "b".repeat(64), desiredStateHash: "c".repeat(64), previousKeys: ["runtime:core"], desiredKeys: ["runtime:build", "runtime:core"], previousProfiles: [], desiredProfiles: ["build"], previousServices: ["portal", "postgres"], desiredServices: ["build", "portal", "postgres"] }; }
function run(env, id = "RCT-test") { return spawnSync(process.execPath, [script, "--runtime-capability-transition", id], { env: { ...process.env, ...env }, encoding: "utf8" }); }
async function secretFile(dir) { const path = join(dir, "secret"); await writeFile(path, secret, { mode: 0o600 }); return path; }

test("protocol probe reports packaged support without reading secrets or creating host state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-probe-"));
  const result = spawnSync(process.execPath, [script, "--runtime-capability-protocol-info"], {
    env: { ...process.env, DPF_PROMOTER_STATE_DIR: dir, DPF_RUNTIME_TRANSITION_SECRET_FILE: join(dir, "absent-secret"), DPF_CANDIDATE_SOURCE_SHA: "probe-fixture-source" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const info = JSON.parse(result.stdout);
  assert.equal(info.schemaVersion, 1);
  assert.equal(info.sourceSha, "probe-fixture-source");
  assert.deepEqual(info.signingVersions, [1, 2]);
  assert.deepEqual(info.applyVersions, [1, 2]);
  assert.deepEqual(info.reconciliationVersions, [2]);
  assert.match(info.actuatorSha256, /^[a-f0-9]{64}$/);
  assert.match(info.signerSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await readdir(dir), []);
});

test("a protocol probe cannot be combined with a state-changing invocation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-probe-mixed-"));
  for (const args of [
    ["--runtime-capability-protocol-info", "--runtime-capability-transition", "RCT-test"],
    ["--runtime-capability-transition", "RCT-test", "--runtime-capability-protocol-info"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, DPF_PROMOTER_STATE_DIR: dir, DPF_RUNTIME_TRANSITION_SECRET_FILE: join(dir, "absent-secret") } });
    assert.equal(result.status, 64, result.stderr);
    assert.match(result.stderr, /invalid_runtime_protocol_probe_arguments/);
    assert.deepEqual(await readdir(dir), []);
  }
});

test("the packaged read-only probe validates and binds the supplied host snapshot", async () => {
  const snapshot = JSON.stringify({ schemaVersion: 1, installerVersion: "fixture", platform: "linux", arch: "amd64" });
  const result = spawnSync(process.execPath, [script, "--runtime-capability-protocol-info"], {
    env: { ...process.env, DPF_RUNTIME_VALIDATE_SNAPSHOT: Buffer.from(snapshot).toString("base64url") }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).validatedSnapshotSha256, createHash("sha256").update(snapshot).digest("hex"));
});

test("the packaged read-only probe rejects a schema-invalid snapshot without host mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-invalid-snapshot-probe-"));
  const result = spawnSync(process.execPath, [script, "--runtime-capability-protocol-info"], {
    env: { ...process.env, DPF_PROMOTER_STATE_DIR: dir, DPF_RUNTIME_VALIDATE_SNAPSHOT: Buffer.from('{"schemaVersion":2}').toString("base64url") }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(await readdir(dir), []);
});

async function validTransition(dir, health = "healthy", version = 1, { previousRequested = [], desiredRequested, stateExtras = {} } = {}) {
  const catalogPath = new URL("./capability-service-catalog.generated.json", import.meta.url);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const project = (requested) => {
    const enabled = new Set();
    const byId = new Map(catalog.capabilities.map((capability) => [capability.capabilityId, capability]));
    const add = (id) => { if (enabled.has(id)) return; const capability = byId.get(id); for (const dependency of capability.dependencies) add(dependency); enabled.add(id); };
    for (const capability of catalog.capabilities) if (capability.activationPolicy === "always") add(capability.capabilityId);
    for (const id of requested) add(id);
    const keys = [...enabled].sort();
    const services = catalog.capabilities.filter((capability) => enabled.has(capability.capabilityId)).flatMap((capability) => capability.services).filter((service) => service.targetClassification !== "ephemeral-lifecycle");
    return { keys, profiles: [...new Set(services.flatMap((service) => service.profiles))].sort(), required: [...new Set(services.map((service) => service.service))].sort(), hash: createHash("sha256").update(`${catalog.catalogHash}\n${catalog.capabilities.map((capability) => `${capability.capabilityId}=${enabled.has(capability.capabilityId) ? "active" : "disabled"}`).sort().join("\n")}`).digest("hex") };
  };
  const previous = project(previousRequested);
  const optional = catalog.capabilities.find((capability) => capability.activationPolicy !== "always");
  assert.ok(optional, "fixture needs an optional runtime capability");
  const desired = project(desiredRequested ?? [optional.capabilityId]);
  const value = { ...envelope(), version, ...(version === 2 ? { kind: "runtime-capability-transition", mode: "transition" } : {}), catalogHash: catalog.catalogHash, previousStateHash: previous.hash, desiredStateHash: desired.hash, previousKeys: previous.keys, desiredKeys: desired.keys, previousProfiles: previous.profiles, desiredProfiles: desired.profiles, previousServices: previous.required, desiredServices: desired.required };
  const signature = signTransitionPayload(value, secret);
  await writeFile(join(dir, "install-state.json"), JSON.stringify({ schemaVersion: 1, installerVersion: "test", platform: "linux", arch: "amd64", enabledRuntimeCapabilities: previous.keys, capabilityCatalogHash: catalog.catalogHash, capabilityStateVersion: previous.hash, ...stateExtras }));
  const fakeDocker = join(dir, "fake-docker.mjs");
  const psRows = desired.required.map((Service) => ({ Service, State: "running", Health: health }));
  await writeFile(fakeDocker, `const args = process.argv.slice(2).join(" ");\nif (args.includes("ps --format json")) process.stdout.write(${JSON.stringify(JSON.stringify(psRows))});\n`);
  return { value, signature, catalogPath: catalogPath.pathname.replace(/^\/(.:\/)/, "$1"), desired, env: { DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature, DPF_PROMOTER_STATE_DIR: dir, DPF_CAPABILITY_CATALOG_PATH: catalogPath.pathname.replace(/^\/(.:\/)/, "$1"), PROMOTE_COMPOSE_PROJECT: "dpf", DPF_DOCKER_BIN: process.execPath, DPF_DOCKER_PREFIX_ARGS: JSON.stringify([fakeDocker]) } };
}

test("version 2 ordinary apply recursively authenticates health and preserves replay identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-v2-"));
  const fixture = await validTransition(dir, "healthy", 2);
  const applied = run(fixture.env);
  assert.equal(applied.status, 0, applied.stderr);
  const receipt = JSON.parse(applied.stdout);
  const { signature, ...unsigned } = receipt;
  verifyTransitionSignature(unsigned, signature, secret);
  const changed = { ...unsigned, observedHealth: { ...unsigned.observedHealth, [fixture.desired.required[0]]: "unhealthy" } };
  assert.throws(() => verifyTransitionSignature(changed, signature, secret), /tampered/);
  const replay = run(fixture.env);
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(JSON.parse(replay.stdout), receipt);
});

test("version 2 reconciliation without its explicit packet never enters the ordinary actuator", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-v2-mode-"));
  const fixture = await validTransition(dir, "healthy", 2);
  const value = { ...fixture.value, mode: "reconciliation" };
  const before = await readFile(join(dir, "install-state.json"), "utf8");
  const result = run({ ...fixture.env, DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signTransitionPayload(value, secret) });
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /unsupported_runtime_transition_mode/);
  assert.equal(await readFile(join(dir, "install-state.json"), "utf8"), before);
  const files = await readdir(join(dir, "runtime-capability-transitions"));
  assert.ok(files.every(file => !file.endsWith(".journal.json") && !file.endsWith(".claim")));
});

async function reconciliationFixture(dir, { touched, databaseStates, ...options } = {}) {
  const fixture = await validTransition(dir, "healthy", 2, options);
  const catalog = JSON.parse(await readFile(fixture.catalogPath, "utf8"));
  const observedHost = JSON.parse(await readFile(join(dir, "install-state.json"), "utf8"));
  const touchedKeys = touched ?? fixture.value.desiredKeys.filter(key => !fixture.value.previousKeys.includes(key));
  const observedDatabaseStates = databaseStates?.observed ?? Object.fromEntries(catalog.capabilities.map(capability => [capability.capabilityId,
    fixture.value.desiredKeys.includes(capability.capabilityId) ? "active" : "disabled"]));
  const value = { ...fixture.value, mode: "reconciliation", protocolIdentity: {
    sourceSha: "a".repeat(40), promoterDigest: `sha256:${"d".repeat(64)}`,
    actuatorSha256: createHash("sha256").update(await readFile(script)).digest("hex"),
    signerSha256: createHash("sha256").update(await readFile(new URL("./lib/transition-signing.mjs", import.meta.url))).digest("hex"),
  }, reconciliation: {
    observedHost, observedDatabaseStates, desiredHostEnabledKeys: fixture.value.desiredKeys,
    desiredDatabaseStates: { ...observedDatabaseStates, ...(databaseStates?.desired ?? {}) }, touchedKeys,
  } };
  const env = () => ({ ...fixture.env, DPF_CANDIDATE_SOURCE_SHA: "a".repeat(40), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"),
    DPF_RUNTIME_TRANSITION_SIGNATURE: signTransitionPayload(value, secret) });
  return { value, env };
}

test("reconciliation refuses missing immutable protocol identity before journaling", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-reconciliation-missing-protocol-")), fixture = await reconciliationFixture(dir);
  delete fixture.value.protocolIdentity;
  const result = run(fixture.env());
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /runtime_protocol_identity_mismatch/);
  assert.ok((await readdir(join(dir, "runtime-capability-transitions"))).every(file => !file.endsWith(".journal.json")));
});
for (const member of ["sourceSha", "actuatorSha256", "signerSha256"]) test(`reconciliation refuses the wrong packaged ${member} before journaling`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-reconciliation-wrong-protocol-")), fixture = await reconciliationFixture(dir);
  fixture.value.protocolIdentity[member] = "f".repeat(member === "sourceSha" ? 40 : 64);
  const result = run(fixture.env());
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /runtime_protocol_identity_mismatch/);
  assert.ok((await readdir(join(dir, "runtime-capability-transitions"))).every(file => !file.endsWith(".journal.json")));
});

test("signed reconciliation applies the actual host baseline despite independent database disagreement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-reconciliation-"));
  const fixture = await reconciliationFixture(dir);
  const result = run(fixture.env());
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.reconciliation, fixture.value.reconciliation);
  assert.equal(receipt.mode, "reconciliation");
  const replay = run(fixture.env());
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(JSON.parse(replay.stdout), receipt);
});

test("reconciliation refuses a signed but different host identity before journaling or state mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-reconciliation-identity-"));
  const fixture = await reconciliationFixture(dir);
  const before = await readFile(join(dir, "install-state.json"), "utf8");
  fixture.value.reconciliation.observedHost.arch = "arm64";
  const result = run(fixture.env());
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /reconciliation_host_identity_mismatch/);
  assert.equal(await readFile(join(dir, "install-state.json"), "utf8"), before);
  assert.ok((await readdir(join(dir, "runtime-capability-transitions"))).every(file => !file.endsWith(".journal.json")));
});

test("failed reconciliation never restores over a subsequent host writer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-reconciliation-writer-"));
  const fixture = await reconciliationFixture(dir);
  const actuator = join(dir, "intervening-writer.mjs"), calls = join(dir, "calls.jsonl"), statePath = join(dir, "install-state.json");
  await writeFile(actuator, `import fs from 'node:fs';
const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if(args.includes('up')) { const state=JSON.parse(fs.readFileSync(${JSON.stringify(statePath)},'utf8')); state.capabilityStateVersion=${JSON.stringify("f".repeat(64))}; fs.writeFileSync(${JSON.stringify(statePath)},JSON.stringify(state)); process.exit(1); }
`);
  const result = run({ ...fixture.env(), DPF_DOCKER_PREFIX_ARGS: JSON.stringify([actuator]) });
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /install_state_ownership_changed/);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).capabilityStateVersion, "f".repeat(64));
  const commands = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(commands.filter(args => args.includes("up")).length, 1);
});

test("prepared reconciliation never overwrites a subsequent nested install-state writer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-reconciliation-nested-resume-"));
  const fixture = await reconciliationFixture(dir), statePath = join(dir, "install-state.json");
  const original = JSON.parse(await readFile(statePath, "utf8"));
  original.edge = { enabled: false, mode: null };
  await writeFile(statePath, JSON.stringify(original));
  fixture.value.reconciliation.observedHost = original;
  const crash = run({ ...fixture.env(), DPF_TEST_CRASH_AFTER_PHASE: "prepared" });
  assert.equal(crash.status, 86, crash.stderr);
  const later = { ...original, edge: { enabled: true, mode: "local" } };
  await writeFile(statePath, JSON.stringify(later));
  const resumed = run(fixture.env());
  assert.equal(resumed.status, 78, resumed.stderr);
  assert.match(resumed.stderr, /install_state_journal_mismatch/);
  assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), later);
});

for (const version of [1, 2]) for (const [crashPoint, durablePhase] of [["prepared", "prepared"], ["install-state-renamed-before-journal", "prepared"], ["state-written", "state-written"], ["runtime-mutated", "state-written"], ["runtime-reconciled", "runtime-reconciled"]]) test(`version ${version} recovers atomically from a crash after ${crashPoint}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "dpf-transition-crash-"));
    const fixture = await validTransition(dir, "healthy", version);
    const crashed = run({ ...fixture.env, DPF_TEST_CRASH_AFTER_PHASE: crashPoint });
    assert.equal(crashed.status, 86, crashed.stderr);
    const journalPath = join(dir, "runtime-capability-transitions", "RCT-test.journal.json");
    assert.equal(JSON.parse(await readFile(journalPath, "utf8")).phase, durablePhase);

    const recovered = run(fixture.env);
    assert.equal(recovered.status, 0, recovered.stderr);
    const state = JSON.parse(await readFile(join(dir, "install-state.json"), "utf8"));
    assert.deepEqual(state.enabledRuntimeCapabilities, fixture.desired.keys);
    await assert.rejects(readFile(journalPath, "utf8"), { code: "ENOENT" });
    const receipt = JSON.parse(await readFile(join(dir, "runtime-capability-transitions", "RCT-test.json"), "utf8"));
    assert.equal(receipt.status, "applied");
    assert.deepEqual(Object.keys(receipt.observedHealth), fixture.desired.required);
    assert.ok(Object.values(receipt.observedHealth).every((status) => status === "healthy"));
  });

test("fails and restores install state when a required compose healthcheck is unhealthy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-unhealthy-"));
  const fixture = await validTransition(dir, "unhealthy");
  const result = run(fixture.env);
  assert.equal(result.status, 78);
  assert.match(result.stderr, /required_health_failed_/);
  const state = JSON.parse(await readFile(join(dir, "install-state.json"), "utf8"));
  assert.deepEqual(state.enabledRuntimeCapabilities, fixture.value.previousKeys);
});

test("rejects a schema-invalid install state before host mutation", async () => {
  const catalogPath = new URL("./capability-service-catalog.generated.json", import.meta.url);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const enabled = new Set();
  const byId = new Map(catalog.capabilities.map((capability) => [capability.capabilityId, capability]));
  const add = (id) => { if (enabled.has(id)) return; const capability = byId.get(id); for (const dependency of capability.dependencies) add(dependency); enabled.add(id); };
  for (const capability of catalog.capabilities) if (capability.activationPolicy === "always") add(capability.capabilityId);
  const keys = [...enabled].sort();
  const services = catalog.capabilities.filter((capability) => enabled.has(capability.capabilityId)).flatMap((capability) => capability.services).filter((service) => service.targetClassification !== "ephemeral-lifecycle");
  const profiles = [...new Set(services.flatMap((service) => service.profiles))].sort();
  const required = [...new Set(services.map((service) => service.service))].sort();
  const stateHash = createHash("sha256").update(`${catalog.catalogHash}\n${catalog.capabilities.map((capability) => `${capability.capabilityId}=${enabled.has(capability.capabilityId) ? "active" : "disabled"}`).sort().join("\n")}`).digest("hex");
  const value = { ...envelope(), catalogHash: catalog.catalogHash, previousStateHash: stateHash, desiredStateHash: stateHash, previousKeys: keys, desiredKeys: keys, previousProfiles: profiles, desiredProfiles: profiles, previousServices: required, desiredServices: required };
  const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-"));
  await writeFile(join(dir, "install-state.json"), JSON.stringify({ schemaVersion: 1, installerVersion: "test", platform: "linux", arch: "amd64", enabledRuntimeCapabilities: keys, capabilityCatalogHash: catalog.catalogHash, capabilityStateVersion: stateHash, unexpected: true }));
  const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature, DPF_PROMOTER_STATE_DIR: dir, DPF_CAPABILITY_CATALOG_PATH: catalogPath.pathname.replace(/^\/(.:\/)/, "$1"), PROMOTE_COMPOSE_PROJECT: "dpf" });
  assert.equal(result.status, 78);
  assert.match(result.stderr, /install_state_schema_invalid/);
});

test("rejects a tampered transition envelope before reading state", async () => {
  const value = envelope();
  const dir = await mkdtemp(join(tmpdir(), "dpf-secret-")); const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: "0".repeat(64), DPF_PROMOTER_STATE_DIR: dir });
  assert.equal(result.status, 78); assert.match(result.stderr, /tampered_envelope/);
});

test("rejects expired signed envelopes", async () => {
  const value = envelope(0); const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const dir = await mkdtemp(join(tmpdir(), "dpf-secret-")); const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature, DPF_PROMOTER_STATE_DIR: dir });
  assert.equal(result.status, 78); assert.match(result.stderr, /expired_or_invalid_envelope/);
});

test("fails closed before mutation when the signed catalog projection is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-"));
  await writeFile(join(dir, "install-state.json"), JSON.stringify({ schemaVersion: 1, capabilityCatalogHash: "f".repeat(64), capabilityStateVersion: "b".repeat(64) }));
  const value = envelope(); const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature, DPF_PROMOTER_STATE_DIR: dir, PROMOTE_COMPOSE_PROJECT: "dpf" });
  assert.equal(result.status, 78); assert.match(result.stderr, /capability_catalog_unreadable/);
  assert.equal(JSON.parse(await readFile(join(dir, "install-state.json"), "utf8")).capabilityCatalogHash, "f".repeat(64));
});


test("expired apply timestamp cannot evict an unmeasured owner", async t => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = await validTransition(dir);
  const lock = join(dir, ".runtime-transition-apply.lock");
  await mkdir(lock);
  const expired = new Date(Date.now() - 60_000).toISOString();
  await writeFile(join(lock, "expires-at"), expired);
  const before = await readFile(join(dir, "install-state.json"));
  const result = run(fixture.env);
  assert.equal(result.status, 75, result.stderr);
  assert.match(result.stderr, /transition_apply_in_progress/);
  assert.equal(await readFile(join(lock, "expires-at"), "utf8"), expired);
  assert.deepEqual(await readFile(join(dir, "install-state.json")), before);
});

// BI-28D2919A: a portal change to an operator-decided capability records the
// operator's decision in install-state, so the installer and the settings page
// stop treating monitoring as undecided after the operator chose.
const MONITORING = "runtime:deep-observability";
const v2State = (decisions) => ({ schemaVersion: 2, ...(decisions ? { runtimeCapabilityDecisions: decisions } : {}) });
const carried = { [MONITORING]: { decision: "undecided", source: "upgrade-carried", decidedAt: "2026-10-01T00:00:00.000Z" } };

test("a normal-mode enable of monitoring records the operator's enabled decision from the portal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-decision-enable-"));
  const fixture = await validTransition(dir, "healthy", 2, { desiredRequested: [MONITORING], stateExtras: v2State(carried) });
  const result = run(fixture.env);
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(await readFile(join(dir, "install-state.json"), "utf8"));
  assert.ok(state.enabledRuntimeCapabilities.includes(MONITORING));
  assert.deepEqual(state.runtimeCapabilityDecisions[MONITORING], { decision: "enabled", source: "portal", decidedAt: fixture.value.issuedAt });
});

test("a reconciliation touching monitoring records the disabled decision even when the host is unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-reconciliation-decision-disable-"));
  // The live drift: host core-only, the monitoring record says active.
  const catalog = JSON.parse(await readFile(new URL("./capability-service-catalog.generated.json", import.meta.url), "utf8"));
  const observed = Object.fromEntries(catalog.capabilities.map(capability => [capability.capabilityId,
    capability.activationPolicy === "always" || capability.capabilityId === MONITORING ? "active" : "disabled"]));
  const fixture = await reconciliationFixture(dir, { desiredRequested: [], stateExtras: v2State(carried), touched: [MONITORING],
    databaseStates: { observed, desired: { [MONITORING]: "disabled" } } });
  assert.deepEqual(fixture.value.previousKeys, fixture.value.desiredKeys);
  const result = run(fixture.env());
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(await readFile(join(dir, "install-state.json"), "utf8"));
  assert.ok(!state.enabledRuntimeCapabilities.includes(MONITORING));
  assert.deepEqual(state.runtimeCapabilityDecisions[MONITORING], { decision: "disabled", source: "portal", decidedAt: fixture.value.issuedAt });
});

test("a transition that leaves monitoring alone leaves the recorded decisions untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-decision-unrelated-"));
  const fixture = await validTransition(dir, "healthy", 2, { stateExtras: v2State(carried) });
  assert.ok(!fixture.value.desiredKeys.includes(MONITORING));
  const result = run(fixture.env);
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(await readFile(join(dir, "install-state.json"), "utf8"));
  assert.deepEqual(state.runtimeCapabilityDecisions, carried);
});

test("a schema v1 install-state gains no decision map", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-decision-v1-"));
  const fixture = await validTransition(dir, "healthy", 2, { desiredRequested: [MONITORING] });
  const result = run(fixture.env);
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(await readFile(join(dir, "install-state.json"), "utf8"));
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.runtimeCapabilityDecisions, undefined);
});

for (const crashPoint of ["prepared", "state-written", "runtime-reconciled"]) test(`a recorded decision survives crash replay after ${crashPoint} (journal equality)`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-decision-crash-"));
  const fixture = await validTransition(dir, "healthy", 2, { desiredRequested: [MONITORING], stateExtras: v2State(carried) });
  const crashed = run({ ...fixture.env, DPF_TEST_CRASH_AFTER_PHASE: crashPoint });
  assert.equal(crashed.status, 86, crashed.stderr);
  // A recomputed next must not depend on the wall clock.
  await new Promise(resolve => setTimeout(resolve, 20));
  const recovered = run(fixture.env);
  assert.equal(recovered.status, 0, recovered.stderr);
  const state = JSON.parse(await readFile(join(dir, "install-state.json"), "utf8"));
  assert.deepEqual(state.runtimeCapabilityDecisions[MONITORING], { decision: "enabled", source: "portal", decidedAt: fixture.value.issuedAt });
});
