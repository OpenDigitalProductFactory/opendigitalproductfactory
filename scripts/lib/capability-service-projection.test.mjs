import assert from "node:assert/strict";
import test from "node:test";

import { compileCapabilityServiceCatalog, resolveCapabilityServiceProjection } from "./capability-service-projection.mjs";

const capability = (capabilityId, dependencies = [], state = "active") => ({
  capabilityId,
  state,
  manifest: { runtime: { dependencies, activation: { policy: capabilityId === "runtime:core" ? "always" : "operator-controlled" } } },
});

const capabilities = [
  capability("runtime:core"),
  capability("runtime:build", ["runtime:core"]),
  capability("runtime:local-speech", ["runtime:core"]),
  capability("runtime:deep-observability", ["runtime:core"]),
  capability("runtime:external-ai", ["runtime:core"]),
];

const service = (serviceName, capabilityId, options = {}) => ({
  service: serviceName,
  capability: capabilityId,
  class: options.class ?? "capability-activated",
  defaultRequired: options.defaultRequired ?? false,
  profiles: options.profiles ?? [capabilityId.slice(8)],
  dependsOn: options.dependsOn ?? [],
  backupPolicy: options.backupPolicy ?? "excluded-stateless",
  healthSemantics: options.healthSemantics ?? "compose-healthcheck",
  hostPlatforms: ["windows", "macos", "linux"],
});

const substrate = {
  version: 2,
  services: [
    service("postgres", "runtime:core", { class: "universal-core", defaultRequired: true, profiles: [], backupPolicy: "included" }),
    service("portal", "runtime:core", { class: "universal-core", defaultRequired: true, profiles: [], dependsOn: ["postgres"], backupPolicy: "included" }),
    service("sandbox", "runtime:build", { backupPolicy: "excluded-ephemeral" }),
    service("dpf-stt", "runtime:local-speech", { profiles: ["local-speech"] }),
    service("dpf-tts", "runtime:local-speech", { profiles: ["local-speech"], backupPolicy: "separate-required" }),
    service("prometheus", "runtime:deep-observability", { profiles: ["deep-observability"], backupPolicy: "separate-required" }),
  ],
  externalRuntimes: [{ runtimeKey: "openai", kind: "ai-runtime", activation: "provider-configuration", healthSemantics: "provider-health-reconciliation", hostPlatforms: ["windows", "macos", "linux"] }],
};

const fixtures = {
  core: ["runtime:core"],
  build: ["runtime:build"],
  "local-speech": ["runtime:local-speech"],
  "deep-observability": ["runtime:deep-observability"],
  "external-ai": ["runtime:external-ai"],
};

for (const [name, enabledRuntimeCapabilities] of Object.entries(fixtures)) {
  test(`${name} fixture resolves a stable capability projection`, () => {
    const enabledClosure = new Set(["runtime:core", ...enabledRuntimeCapabilities]);
    const fixtureCapabilities = capabilities.map((entry) => ({ ...entry, state: enabledClosure.has(entry.capabilityId) ? "active" : "disabled" }));
    const first = resolveCapabilityServiceProjection({ substrate, capabilities: fixtureCapabilities, enabledRuntimeCapabilities });
    const second = resolveCapabilityServiceProjection({
      substrate: { ...substrate, services: [...substrate.services].reverse().map((entry) => ({ ...entry, profiles: [...entry.profiles].reverse(), dependsOn: [...entry.dependsOn].reverse(), hostPlatforms: [...entry.hostPlatforms].reverse() })) },
      capabilities: [...fixtureCapabilities].reverse(),
      enabledRuntimeCapabilities: [...enabledRuntimeCapabilities].reverse(),
    });
    assert.deepEqual(second, first);
    assert.ok(first.enabledRuntimeCapabilities.includes("runtime:core"));
    assert.match(first.capabilityStateVersion, /^[a-f0-9]{64}$/);
    assert.deepEqual(first.requiredServices, first.serviceRequirements.map((entry) => entry.service));
    assert.deepEqual(first.composeProfiles, [...first.composeProfiles].sort());
    assert.deepEqual(first.backupServices, [...first.backupServices].sort());
    assert.deepEqual(first.healthRequirements, [...first.healthRequirements].sort((a, b) => a.service.localeCompare(b.service)));
    if (name === "external-ai") assert.deepEqual(first.externalRuntimes.map((item) => item.runtimeKey), ["openai"]);
    else assert.deepEqual(first.externalRuntimes, []);
  });
}

test("catalog contains every valid binding rather than install state", () => {
  const catalog = compileCapabilityServiceCatalog({ substrate, capabilities });
  assert.deepEqual(catalog.capabilities.map((entry) => entry.capabilityId), capabilities.map((entry) => entry.capabilityId).sort());
  assert.equal(catalog.capabilities.find((entry) => entry.capabilityId === "runtime:external-ai").externalRuntimes[0].runtimeKey, "openai");
  assert.match(catalog.catalogHash, /^[a-f0-9]{64}$/);
});

test("dependency cycles fail closed with their path", () => {
  const cyclic = [capability("a", ["b"]), capability("b", ["a"])];
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { version: 1, services: [], externalRuntimes: [] }, capabilities: cyclic }), /capability_dependency_cycle:a -> b -> a/);
});

test("unknown capability bindings fail closed", () => {
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { ...substrate, services: [...substrate.services, service("orphan", "runtime:missing")] }, capabilities }), /unknown_service_capability:orphan:runtime:missing/);
  assert.throws(() => resolveCapabilityServiceProjection({ substrate, capabilities, enabledRuntimeCapabilities: ["runtime:missing"] }), /unknown_runtime_capability:runtime:missing/);
});

test("conflicting persisted and live capability authorities fail closed", () => {
  assert.throws(() => resolveCapabilityServiceProjection({ substrate, capabilities, enabledRuntimeCapabilities: ["runtime:core"] }), /capability_state_stale/);
});

test("duplicate services fail closed", () => {
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { ...substrate, services: [...substrate.services, substrate.services[0]] }, capabilities }), /duplicate_substrate_service:postgres/);
});
