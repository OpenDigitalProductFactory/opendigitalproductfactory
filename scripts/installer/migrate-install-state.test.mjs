import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { projectInstallState } from "./migrate-install-state.mjs";
import { resolveHostIdentity } from "./resolve-host-identity.mjs";

const catalog = JSON.parse(await readFile(new URL("../capability-service-catalog.generated.json", import.meta.url), "utf8"));
const MIGRATOR = fileURLToPath(new URL("./migrate-install-state.mjs", import.meta.url));
const CATALOG_PATH = fileURLToPath(new URL("../capability-service-catalog.generated.json", import.meta.url));
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

test("CLI persists the canonical projection through the shared transaction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dpf-migrator-cli-"));
  const statePath = join(directory, "install-state.json");
  await writeFile(statePath, Buffer.from(`\ufeff${JSON.stringify(legacy)}`));
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("./migrate-install-state.mjs", import.meta.url)), "--state", statePath,
    "--catalog", fileURLToPath(new URL("../capability-service-catalog.generated.json", import.meta.url)),
    "--host-platform", "win32", "--host-arch", "amd64", "--write",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const migrated = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.platform, "win32");
  assert.equal(migrated.arch, "amd64");
  assert.equal(migrated.capabilityCatalogHash, catalog.catalogHash);
});

test("CLI binds persistence to signed hashes and the governed recovery path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-install-migrate-bound-"));
  try {
    const statePath = join(dir, "install-state.json");
    const recoveryPath = join(dir, "recovery", "install-state.json");
    await mkdir(dirname(recoveryPath), { recursive: true });
    const original = Buffer.from(`\uFEFF${JSON.stringify(legacy)}\n`);
    await writeFile(statePath, original);
    const projection = await projectInstallState({ bytes: original, hostIdentity: identity, catalog });
    const run = spawnSync(process.execPath, [MIGRATOR, "--state", statePath, "--catalog", CATALOG_PATH,
      "--host-platform", "win32", "--host-arch", "amd64", "--expected-source-hash", projection.sourceHash,
      "--expected-projection-hash", projection.projectionHash, "--recovery-path", recoveryPath, "--write"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(await readFile(recoveryPath), original);

    await writeFile(statePath, original);
    const refused = spawnSync(process.execPath, [MIGRATOR, "--state", statePath, "--catalog", CATALOG_PATH,
      "--host-platform", "win32", "--host-arch", "amd64", "--expected-source-hash", "0".repeat(64),
      "--expected-projection-hash", projection.projectionHash, "--recovery-path", recoveryPath, "--write"], { encoding: "utf8" });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /install_state_envelope_state_changed/);
    assert.deepEqual(await readFile(statePath), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
