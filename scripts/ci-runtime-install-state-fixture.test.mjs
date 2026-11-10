import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateInstallState } from "./installer/validate-install-state.mjs";
import { computeCapabilityStateVersion } from "./lib/capability-state-hash.mjs";

test("fresh CI seeds receive explicit validated core-only host evidence", async () => {
  const result = spawnSync(process.execPath, ["scripts/ci-runtime-install-state-fixture.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout);
  assert.equal((await validateInstallState(state)).valid, true);
  assert.deepEqual(state.enabledRuntimeCapabilities, ["runtime:core"]);
  const catalog = JSON.parse(readFileSync("scripts/capability-service-catalog.generated.json", "utf8"));
  assert.equal(state.capabilityCatalogHash, catalog.catalogHash);
  assert.equal(state.capabilityStateVersion, computeCapabilityStateVersion(catalog.catalogHash,
    state.enabledRuntimeCapabilities, catalog.capabilities.map(c => c.capabilityId)));
});

for (const workflow of ["audit-routing-invariants.yml", "ux-route-sweep.yml"]) {
  test(`${workflow} prepares host evidence before its fresh database seed`, () => {
    const source = readFileSync(`.github/workflows/${workflow}`, "utf8");
    const fixture = source.indexOf("node scripts/ci-runtime-install-state-fixture.mjs");
    const seed = source.search(/run: pnpm --filter @dpf\/db (?:run )?seed/);
    assert.ok(fixture >= 0 && fixture < seed, "fixture must precede seed rather than weakening host validation");
    assert.match(source, /sudo install -m 0644.*\/dpf-state\/install-state\.json/);
  });
}
