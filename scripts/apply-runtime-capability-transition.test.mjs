import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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
  assert.deepEqual(info.reconciliationVersions, []);
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

async function validTransition(dir, health = "healthy", version = 1) {
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
  const previous = project([]);
  const optional = catalog.capabilities.find((capability) => capability.activationPolicy !== "always");
  assert.ok(optional, "fixture needs an optional runtime capability");
  const desired = project([optional.capabilityId]);
  const value = { ...envelope(), version, ...(version === 2 ? { kind: "runtime-capability-transition", mode: "transition" } : {}), catalogHash: catalog.catalogHash, previousStateHash: previous.hash, desiredStateHash: desired.hash, previousKeys: previous.keys, desiredKeys: desired.keys, previousProfiles: previous.profiles, desiredProfiles: desired.profiles, previousServices: previous.required, desiredServices: desired.required };
  const signature = signTransitionPayload(value, secret);
  await writeFile(join(dir, "install-state.json"), JSON.stringify({ schemaVersion: 1, installerVersion: "test", platform: "linux", arch: "amd64", enabledRuntimeCapabilities: previous.keys, capabilityCatalogHash: catalog.catalogHash, capabilityStateVersion: previous.hash }));
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

test("version 2 reconciliation cannot enter the ordinary actuator before its protocol is implemented", async () => {
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
