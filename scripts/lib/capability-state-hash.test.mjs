import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { computeCapabilityStateVersion } from "./capability-state-hash.mjs";
import { PRE_PROFILE_COMPATIBILITY_CAPABILITIES, resolveCapabilityComposeProfiles } from "./resolve-capability-compose-profiles.mjs";
import { projectInstallState } from "../installer/migrate-install-state.mjs";

const catalog = JSON.parse(await readFile(new URL("../capability-service-catalog.generated.json", import.meta.url), "utf8"));

test("resolver, transition coordinator, migrated state, and fresh state share byte-identical hashes", async () => {
  const enabled = PRE_PROFILE_COMPATIBILITY_CAPABILITIES;
  const states = Object.fromEntries(catalog.capabilities.map(({ capabilityId }) => [capabilityId, enabled.includes(capabilityId) ? "active" : "disabled"]));
  const canonical = computeCapabilityStateVersion(catalog.catalogHash, states);
  const resolver = resolveCapabilityComposeProfiles({ catalog, state: { schemaVersion: 2, enabledRuntimeCapabilities: enabled, capabilityCatalogHash: catalog.catalogHash, capabilityStateVersion: canonical }, hostPlatform: "windows" });
  const migrated = await projectInstallState({
    bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, installerVersion: "old", platform: "unsupported", arch: "raw-msys" })),
    hostIdentity: { platform: "win32", arch: "amd64", capabilityHostPlatform: "windows", provenance: "explicit" },
    catalog,
  });
  const fresh = resolveCapabilityComposeProfiles({ catalog, state: {}, hostPlatform: "windows", migrate: true });
  const transitionSource = await readFile(new URL("../../apps/web/lib/platform-runtime/transition-coordinator.ts", import.meta.url), "utf8");
  assert.equal(resolver.capabilityStateVersion, canonical);
  assert.equal(migrated.projectedState.capabilityStateVersion, canonical);
  assert.equal(fresh.capabilityStateVersion, canonical);
  assert.match(transitionSource, /computeSharedCapabilityStateVersion\(catalogHash, states\)/);
});

test("canonical hash rejects ambiguous state input", () => {
  assert.throws(() => computeCapabilityStateVersion("catalog", ["runtime:core", "runtime:core"], ["runtime:core"]), /duplicate_capability_state/);
});
