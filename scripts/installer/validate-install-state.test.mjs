import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateInstallState } from "./validate-install-state.mjs";

const valid = {
  schemaVersion: 1,
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

test("uses the repository schema rather than a duplicated field list", async () => {
  const schema = JSON.parse(await readFile(new URL("./install-state.schema.json", import.meta.url), "utf8"));
  const missing = { ...valid };
  delete missing[schema.required[0]];
  const result = await validateInstallState(missing);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), new RegExp(schema.required[0]));
});
