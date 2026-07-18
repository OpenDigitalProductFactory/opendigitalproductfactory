import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";

const script = new URL("./apply-runtime-capability-transition.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const canonical = (v) => JSON.stringify(v, Object.keys(v).sort());
const secret = "s".repeat(32);
function envelope(now = Date.now()) { return { version: 1, transitionId: "RCT-test", issuedAt: new Date(now - 100).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), catalogHash: "a".repeat(64), previousStateHash: "b".repeat(64), desiredStateHash: "c".repeat(64), previousKeys: ["runtime:core"], desiredKeys: ["runtime:build", "runtime:core"], previousProfiles: [], desiredProfiles: ["build"], previousServices: ["portal", "postgres"], desiredServices: ["build", "portal", "postgres"] }; }
function run(env, id = "RCT-test") { return spawnSync(process.execPath, [script, "--runtime-capability-transition", id], { env: { ...process.env, ...env }, encoding: "utf8" }); }
async function secretFile(dir) { const path = join(dir, "secret"); await writeFile(path, secret, { mode: 0o600 }); return path; }

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
  const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature, DPF_STATE_DIR: dir, DPF_CAPABILITY_CATALOG_PATH: catalogPath.pathname.replace(/^\/(.:\/)/, "$1"), PROMOTE_COMPOSE_PROJECT: "dpf" });
  assert.equal(result.status, 78);
  assert.match(result.stderr, /install_state_schema_invalid/);
});

test("rejects a tampered transition envelope before reading state", async () => {
  const value = envelope();
  const dir = await mkdtemp(join(tmpdir(), "dpf-secret-")); const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: "0".repeat(64), DPF_STATE_DIR: dir });
  assert.equal(result.status, 78); assert.match(result.stderr, /tampered_envelope/);
});

test("rejects expired signed envelopes", async () => {
  const value = envelope(0); const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const dir = await mkdtemp(join(tmpdir(), "dpf-secret-")); const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature });
  assert.equal(result.status, 78); assert.match(result.stderr, /expired_or_invalid_envelope/);
});

test("fails closed before mutation when the signed catalog projection is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-transition-"));
  await writeFile(join(dir, "install-state.json"), JSON.stringify({ schemaVersion: 1, capabilityCatalogHash: "f".repeat(64), capabilityStateVersion: "b".repeat(64) }));
  const value = envelope(); const signature = createHmac("sha256", secret).update(canonical(value)).digest("hex");
  const result = run({ DPF_RUNTIME_TRANSITION_SECRET_FILE: await secretFile(dir), DPF_RUNTIME_TRANSITION_ENVELOPE: Buffer.from(JSON.stringify(value)).toString("base64url"), DPF_RUNTIME_TRANSITION_SIGNATURE: signature, DPF_STATE_DIR: dir, PROMOTE_COMPOSE_PROJECT: "dpf" });
  assert.equal(result.status, 78); assert.match(result.stderr, /capability_catalog_unreadable/);
  assert.equal(JSON.parse(await readFile(join(dir, "install-state.json"), "utf8")).capabilityCatalogHash, "f".repeat(64));
});
