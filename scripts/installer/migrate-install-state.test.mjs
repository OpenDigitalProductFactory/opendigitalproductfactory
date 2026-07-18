import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectInstallState } from "./migrate-install-state.mjs";
import { resolveHostIdentity } from "./resolve-host-identity.mjs";

const catalog = JSON.parse(await readFile(new URL("../capability-service-catalog.generated.json", import.meta.url), "utf8"));
const legacy = {
  schemaVersion: 1, installerVersion: "2026.06.26", platform: "unsupported", arch: "x86_64-pc-msys",
  installPath: "D:/DPF", stateDir: "C:/Users/operator/.dpf", composeProjectName: "dpf",
};
const identity = resolveHostIdentity({ state: legacy, env: { DPF_HOST_PLATFORM: "windows", DPF_HOST_ARCH: "amd64" } });

test("projects the observed BOM legacy state deterministically without mutation", async () => {
  const bytes = Buffer.from(`\ufeff${JSON.stringify(legacy)}`);
  const before = Buffer.from(bytes);
  const first = await projectInstallState({ bytes, hostIdentity: identity, catalog });
  const second = await projectInstallState({ bytes, hostIdentity: identity, catalog });
  assert.deepEqual(bytes, before);
  assert.deepEqual(first, second);
  assert.equal(first.migrationRequired, true);
  assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(first.projectionHash, /^[a-f0-9]{64}$/);
  assert.equal(first.projectedState.schemaVersion, 2);
  assert.equal(first.projectedState.platform, "win32");
  assert.equal(first.projectedState.arch, "amd64");
  assert.equal(first.projectedState.capabilityCatalogHash, catalog.catalogHash);
  assert.ok(first.projectedState.enabledRuntimeCapabilities.includes("runtime:external-ai"));
});

test("returns a valid v2 state idempotently", async () => {
  const migrated = await projectInstallState({ bytes: Buffer.from(JSON.stringify(legacy)), hostIdentity: identity, catalog });
  const bytes = Buffer.from(`${JSON.stringify(migrated.projectedState, null, 2)}\n`);
  const result = await projectInstallState({ bytes, hostIdentity: identity, catalog });
  assert.equal(result.migrationRequired, false);
  assert.deepEqual(result.projectedState, migrated.projectedState);
});

test("refuses contradictory capability snapshots", async () => {
  const state = { ...legacy, enabledRuntimeCapabilities: ["runtime:core"], capabilityCatalogHash: "0".repeat(64), capabilityStateVersion: "0".repeat(64) };
  await assert.rejects(projectInstallState({ bytes: Buffer.from(JSON.stringify(state)), hostIdentity: identity, catalog }), /capability_state_stale/);
});

test("refuses unverifiable and future-version state", async () => {
  await assert.rejects(projectInstallState({ bytes: Buffer.from(JSON.stringify(legacy)), catalog }), /host_identity_required/);
  await assert.rejects(projectInstallState({ bytes: Buffer.from(JSON.stringify({ ...legacy, schemaVersion: 3 })), hostIdentity: identity, catalog }), /install_state_newer_than_runtime/);
});
