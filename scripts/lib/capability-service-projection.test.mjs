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
  ports: [],
  volumes: [],
  boundaryReason: "Fixture service boundary.",
  canonicalDataOwner: "none",
});

const substrate = {
  version: 2,
  services: [
    service("postgres", "runtime:core", { class: "universal-core", defaultRequired: true, profiles: [], backupPolicy: "included" }),
    service("portal", "runtime:core", { class: "universal-core", defaultRequired: true, profiles: [], dependsOn: ["postgres"], backupPolicy: "included" }),
    service("promoter", "runtime:core", { class: "ephemeral-lifecycle", profiles: ["promote"], dependsOn: ["postgres"], backupPolicy: "included", healthSemantics: "consumer-observed" }),
    service("sandbox", "runtime:build", { defaultRequired: true, profiles: [], backupPolicy: "excluded-ephemeral" }),
    service("dpf-stt", "runtime:local-speech", { defaultRequired: true, profiles: [] }),
    service("dpf-tts", "runtime:local-speech", { profiles: ["local-speech"], backupPolicy: "separate-required" }),
    service("prometheus", "runtime:deep-observability", { defaultRequired: true, profiles: [], backupPolicy: "separate-required" }),
  ],
  externalRuntimes: [{ runtimeKey: "openai", kind: "ai-runtime", activation: "provider-configuration", canonicalDataOwner: "postgres", boundaryReason: "External inference boundary.", healthSemantics: "provider-health-reconciliation", hostPlatforms: ["windows", "macos", "linux"] }],
};

const fixtures = {
  core: { keys: ["runtime:core"], required: ["portal", "postgres"], inactive: ["dpf-stt", "dpf-tts", "prometheus", "promoter", "sandbox"], backup: ["portal", "postgres"], external: [] },
  build: { keys: ["runtime:build"], required: ["portal", "postgres", "sandbox"], inactive: ["dpf-stt", "dpf-tts", "prometheus", "promoter"], backup: ["portal", "postgres"], external: [] },
  "local-speech": { keys: ["runtime:local-speech"], required: ["dpf-stt", "portal", "postgres"], inactive: ["dpf-tts", "prometheus", "promoter", "sandbox"], backup: ["portal", "postgres"], external: [] },
  "deep-observability": { keys: ["runtime:deep-observability"], required: ["portal", "postgres", "prometheus"], inactive: ["dpf-stt", "dpf-tts", "promoter", "sandbox"], backup: ["portal", "postgres", "prometheus"], external: [] },
  "external-ai": { keys: ["runtime:external-ai"], required: ["portal", "postgres"], inactive: ["dpf-stt", "dpf-tts", "prometheus", "promoter", "sandbox"], backup: ["portal", "postgres"], external: ["openai"] },
};

for (const [name, expected] of Object.entries(fixtures)) {
  test(`${name} fixture resolves a stable capability projection`, () => {
    const enabledRuntimeCapabilities = expected.keys;
    const enabledClosure = new Set(["runtime:core", ...enabledRuntimeCapabilities]);
    const fixtureCapabilities = capabilities.map((entry) => ({ ...entry, state: enabledClosure.has(entry.capabilityId) ? "active" : "disabled" }));
    const first = resolveCapabilityServiceProjection({ substrate, capabilities: fixtureCapabilities, enabledRuntimeCapabilities });
    const second = resolveCapabilityServiceProjection({
      substrate: { ...substrate, services: [...substrate.services].reverse().map((entry) => ({ ...entry, profiles: [...entry.profiles].reverse(), dependsOn: [...entry.dependsOn].reverse(), hostPlatforms: [...entry.hostPlatforms].reverse() })) },
      capabilities: [...fixtureCapabilities].reverse(),
      enabledRuntimeCapabilities: [...enabledRuntimeCapabilities].reverse(),
    });
    assert.deepEqual(second, first);
    assert.deepEqual(first.enabledRuntimeCapabilities, ["runtime:core", ...expected.keys.filter((key) => key !== "runtime:core")].sort());
    assert.match(first.capabilityStateVersion, /^[a-f0-9]{64}$/);
    assert.deepEqual(first.requiredServices, expected.required);
    assert.deepEqual(first.inactiveOptionalServices, expected.inactive);
    assert.deepEqual(first.composeProfiles, []);
    assert.deepEqual(first.backupServices, expected.backup);
    assert.deepEqual(first.healthRequirements, expected.required.map((serviceName) => ({ service: serviceName, semantics: "compose-healthcheck" })));
    assert.deepEqual(first.externalRuntimes.map((item) => item.runtimeKey), expected.external);
    assert.deepEqual(first.serviceRequirements, expected.required.map((serviceName) => {
      const record = substrate.services.find((entry) => entry.service === serviceName);
      return { backupPolicy: record.backupPolicy, capability: record.capability, class: record.class, defaultRequired: true, dependsOn: [...record.dependsOn].sort(), healthSemantics: record.healthSemantics, hostPlatforms: [...record.hostPlatforms].sort(), profiles: [], service: serviceName };
    }));
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

test("undeclared cross-capability service dependencies fail closed", () => {
  const records = [capability("runtime:core"), capability("runtime:queue", ["runtime:core"]), capability("runtime:reports", ["runtime:core"])];
  const services = [
    service("postgres", "runtime:core", { defaultRequired: true, profiles: [] }),
    service("queue", "runtime:queue", { profiles: ["queue"], dependsOn: ["postgres"] }),
    service("reports", "runtime:reports", { defaultRequired: true, profiles: [], dependsOn: ["queue"] }),
  ];
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { version: 2, services, externalRuntimes: [] }, capabilities: records }), /undeclared_cross_capability_dependency:reports:queue:runtime:reports->runtime:queue/);
});

test("closed substrate fields and array values are validated", () => {
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { ...substrate, services: [{ ...substrate.services[0], profiles: [42] }] }, capabilities }), /invalid_substrate_profiles:postgres/);
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { ...substrate, services: [{ ...substrate.services[0], backupPolicy: "sometimes" }] }, capabilities }), /invalid_substrate_service:postgres/);
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { ...substrate, externalRuntimes: [{ ...substrate.externalRuntimes[0], healthSemantics: "ping" }] }, capabilities }), /invalid_external_runtime:openai/);
});
