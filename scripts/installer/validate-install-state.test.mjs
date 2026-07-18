import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseAndValidateInstallStateBytes, validateInstallState } from "./validate-install-state.mjs";
import { currentSchemaVersion, migrationEdges, schemasByVersion } from "./install-state-schema-registry.mjs";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const valid = {
  schemaVersion: 2,
  installerVersion: "2026.07.18",
  platform: "linux",
  arch: "amd64",
  enabledRuntimeCapabilities: ["runtime:core"],
  capabilityCatalogHash: "a".repeat(64),
  capabilityStateVersion: "b".repeat(64),
};

test("validates the canonical install-state schema", async () => {
  assert.deepEqual(await validateInstallState(valid), { valid: true, errors: [] });
});

test("accepts the exact observed BOM-bearing bounded v1 state", async () => {
  const observed = {
    schemaVersion: 1,
    installerVersion: "2026.06.26",
    lastSuccessfulInstallVersion: null,
    lastSuccessfulComposeHash: null,
    platform: "unsupported",
    arch: "x86_64-pc-msys",
    composeProjectName: "dpf",
    dockerContext: null,
    dockerEndpoint: null,
    installPath: "D:/DPF",
    stateDir: "C:/Users/operator/.dpf",
    installMode: null,
    composeFiles: [],
    edge: { enabled: false, mode: null },
    imageTag: null,
    llmProvider: null,
    resourceLabels: { dpf: "true" },
    autostart: { enabled: false, kind: "none" },
    lastHealthCheck: null,
    lastBackupAt: null,
    lastDoctorBundlePath: null,
  };
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(observed))]);
  assert.deepEqual(await parseAndValidateInstallStateBytes(bytes), { valid: true, errors: [], value: observed, schemaVersion: 1 });
});

test("dispatches strict version 2 state to the current schema", async () => {
  assert.deepEqual(await parseAndValidateInstallStateBytes(Buffer.from(JSON.stringify(valid))), {
    valid: true,
    errors: [],
    value: valid,
    schemaVersion: 2,
  });
});

test("rejects unsupported future schema versions with a bounded error", async () => {
  const result = await parseAndValidateInstallStateBytes(Buffer.from(JSON.stringify({ ...valid, schemaVersion: 99 })));
  assert.deepEqual(result, { valid: false, errors: ["$: install_state_newer_than_runtime"], value: undefined, schemaVersion: 99 });
});

test("rejects unknown version 1 properties", async () => {
  const result = await validateInstallState({ schemaVersion: 1, installerVersion: "2026.06.26", platform: "linux", arch: "amd64", surprise: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /\$\.surprise: additionalProperties/);
});

const legacyAgentToolchain = {
  appliedAt: "2026-06-26T12:00:00.000Z",
  dpfPlatformVersion: "2026.06.26",
  superpowersVersion: null,
  claudeCodeWired: true,
  codexWired: true,
  grokWired: false,
  memorySeededAt: null,
  mcpReadiness: { ok: true, toolCount: 12, observedAt: "2026-06-26T12:00:00.000Z" },
  smokeTest: { result: "passed", kernelPrincipleObserved: "never-fabricate", transcript: "ok" },
  readinessState: "ready",
};

test("rejects an empty v1 agentToolchain readiness discriminator", async () => {
  const result = await validateInstallState({
    schemaVersion: 1,
    installerVersion: "2026.06.26",
    platform: "linux",
    arch: "amd64",
    agentToolchain: { ...legacyAgentToolchain, mcpReadiness: {} },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /mcpReadiness: oneOf/);
});

test("rejects contradictory v1 agentToolchain smoke-test variants", async () => {
  const result = await validateInstallState({
    schemaVersion: 1,
    installerVersion: "2026.06.26",
    platform: "linux",
    arch: "amd64",
    agentToolchain: {
      ...legacyAgentToolchain,
      smokeTest: { result: "passed", kernelPrincipleObserved: "never-fabricate", transcript: "ok", reason: "failed" },
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /smokeTest: oneOf/);
});

test("requires schema-version increments and migration edges for required-field changes", () => {
  for (let version = 2; version <= currentSchemaVersion; version += 1) {
    const previous = new Set(schemasByVersion.get(version - 1).required ?? []);
    const added = (schemasByVersion.get(version).required ?? []).filter((field) => !previous.has(field));
    const edge = migrationEdges.get(`${version - 1}->${version}`);
    if (added.length > 0) assert.ok(edge, `required fields ${added.join(", ")} need a migration edge`);
    assert.deepEqual(edge?.addedRequiredFields ?? [], added, `migration edge must declare every required field added in version ${version}`);
  }
  assert.equal(schemasByVersion.get(currentSchemaVersion).properties.schemaVersion.const, currentSchemaVersion);
});

test("enforces nested, format, uniqueness, and additional-property constraints", async () => {
  const result = await validateInstallState({
    ...valid,
    enabledRuntimeCapabilities: ["runtime:core", "runtime:core"],
    lastHealthCheck: "yesterday",
    autostart: { enabled: true, kind: "bogus", surprise: true },
    unknownHostFact: true,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /uniqueItems/);
  assert.match(result.errors.join("\n"), /date-time/);
  assert.match(result.errors.join("\n"), /additionalProperties/);
  assert.match(result.errors.join("\n"), /enum/);
});

test("bounds validation errors and stops with a deterministic truncation sentinel", async () => {
  const malformed = {
    ...valid,
    enabledRuntimeCapabilities: Array.from({ length: 100 }, (_, index) => `invalid-${index}`),
    ...Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`unknown${index}`, true])),
  };
  const result = await validateInstallState(malformed);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 21);
  assert.equal(result.errors.at(-1), "$: validation_errors_truncated");
  assert.equal(result.errors.filter((error) => error === "$: validation_errors_truncated").length, 1);
});

test("enforces strict RFC3339 calendar-valid date-time values", async () => {
  for (const invalid of ["2026", "2026-07-18", "2026-02-30T12:00:00Z", "2025-02-29T12:00:00Z", "2026-07-18T12:00:00+24:00"]) {
    const result = await validateInstallState({ ...valid, lastHealthCheck: invalid });
    assert.equal(result.valid, false, invalid);
    assert.match(result.errors.join("\n"), /date-time format/, invalid);
  }
  for (const accepted of [
    "2024-02-29T12:34:56Z",
    "2026-07-18T12:34:56.123456-05:30",
    "1990-12-31T23:59:60Z",
    "0000-01-01T00:00:00Z",
    "0099-12-31T23:59:59Z",
  ]) {
    assert.deepEqual(await validateInstallState({ ...valid, lastHealthCheck: accepted }), { valid: true, errors: [] }, accepted);
  }
});

test("uses the repository schema rather than a duplicated field list", async () => {
  const schema = JSON.parse(await readFile(new URL("./install-state.schema.json", import.meta.url), "utf8"));
  const versioned = JSON.parse(await readFile(new URL("./install-state.v2.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(schema, versioned);
  const missing = { ...valid };
  delete missing[schema.required[0]];
  const result = await validateInstallState(missing);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), new RegExp(schema.required[0]));
});

test("command-line contract validates the installer-resolved state path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dpf-state-validator-"));
  const path = join(dir, "install-state.json");
  await writeFile(path, JSON.stringify(valid));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./validate-install-state.mjs", import.meta.url)), path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /install-state valid/);
});
