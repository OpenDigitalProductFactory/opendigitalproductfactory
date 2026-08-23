import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { compileCapabilityServiceCatalog, resolveCapabilityServiceProjection } from "./capability-service-projection.mjs";

const capability = (capabilityId, dependencies = [], state = "active") => ({
  capabilityId,
  state,
  manifest: { runtime: { dependencies, activation: { policy: capabilityId === "runtime:core" ? "always" : "operator-controlled" }, ...(capabilityId === "runtime:core" ? {} : { workGuards: [] }) } },
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
  targetClassification: options.class ?? "capability-activated",
});

const substrate = {
  version: 2,
  services: [
    service("postgres", "runtime:core", { class: "universal-core", defaultRequired: true, profiles: [], backupPolicy: "included" }),
    service("portal-init", "runtime:core", { class: "ephemeral-lifecycle", defaultRequired: true, profiles: [], dependsOn: ["postgres"], backupPolicy: "included", healthSemantics: "lifecycle-completion" }),
    service("portal", "runtime:core", { class: "universal-core", defaultRequired: true, profiles: [], dependsOn: ["portal-init"], backupPolicy: "included" }),
    service("promoter", "runtime:core", { class: "ephemeral-lifecycle", profiles: ["promote"], dependsOn: ["postgres"], backupPolicy: "included", healthSemantics: "consumer-observed" }),
    service("sandbox-init", "runtime:build", { class: "ephemeral-lifecycle", defaultRequired: true, profiles: [], dependsOn: ["postgres"], backupPolicy: "excluded-ephemeral", healthSemantics: "lifecycle-completion" }),
    service("sandbox", "runtime:build", { defaultRequired: true, profiles: [], dependsOn: ["sandbox-init"], backupPolicy: "excluded-ephemeral" }),
    service("dpf-stt", "runtime:local-speech", { defaultRequired: true, profiles: [] }),
    service("dpf-tts", "runtime:local-speech", { profiles: ["local-speech"], backupPolicy: "separate-required" }),
    service("prometheus", "runtime:deep-observability", { defaultRequired: true, profiles: [], backupPolicy: "separate-required" }),
    service("grafana", "runtime:deep-observability", { profiles: ["observability-ui"], dependsOn: ["prometheus"], backupPolicy: "separate-required" }),
  ],
  externalRuntimes: [{ runtimeKey: "openai", kind: "ai-runtime", activation: "provider-configuration", canonicalDataOwner: "postgres", boundaryReason: "External inference boundary.", healthSemantics: "provider-health-reconciliation", hostPlatforms: ["windows", "macos", "linux"] }],
};

const fixtures = {
  core: { keys: ["runtime:core"], required: ["portal", "portal-init", "postgres"], inactive: ["dpf-stt", "dpf-tts", "grafana", "prometheus", "promoter", "sandbox", "sandbox-init"], profiles: [], backup: ["portal", "portal-init", "postgres"], external: [] },
  build: { keys: ["runtime:build"], required: ["portal", "portal-init", "postgres", "sandbox", "sandbox-init"], inactive: ["dpf-stt", "dpf-tts", "grafana", "prometheus", "promoter"], profiles: [], backup: ["portal", "portal-init", "postgres"], external: [] },
  "local-speech": { keys: ["runtime:local-speech"], required: ["dpf-stt", "dpf-tts", "portal", "portal-init", "postgres"], inactive: ["grafana", "prometheus", "promoter", "sandbox", "sandbox-init"], profiles: ["local-speech"], backup: ["dpf-tts", "portal", "portal-init", "postgres"], external: [] },
  "deep-observability": { keys: ["runtime:deep-observability"], required: ["grafana", "portal", "portal-init", "postgres", "prometheus"], inactive: ["dpf-stt", "dpf-tts", "promoter", "sandbox", "sandbox-init"], profiles: ["observability-ui"], backup: ["grafana", "portal", "portal-init", "postgres", "prometheus"], external: [] },
  "external-ai": { keys: ["runtime:external-ai"], required: ["portal", "portal-init", "postgres"], inactive: ["dpf-stt", "dpf-tts", "grafana", "prometheus", "promoter", "sandbox", "sandbox-init"], profiles: [], backup: ["portal", "portal-init", "postgres"], external: ["openai"] },
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
    assert.deepEqual(first.composeProfiles, expected.profiles);
    assert.deepEqual(first.backupServices, expected.backup);
    assert.deepEqual(first.healthRequirements, expected.required.map((serviceName) => ({ service: serviceName, semantics: substrate.services.find((entry) => entry.service === serviceName).healthSemantics })));
    assert.deepEqual(first.externalRuntimes.map((item) => item.runtimeKey), expected.external);
    assert.deepEqual(first.serviceRequirements, expected.required.map((serviceName) => {
      const record = substrate.services.find((entry) => entry.service === serviceName);
      return { ...record, dependsOn: [...record.dependsOn].sort(), hostPlatforms: [...record.hostPlatforms].sort(), ports: [], profiles: [...record.profiles].sort(), volumes: [] };
    }));
  });
}

test("catalog contains every valid binding rather than install state", () => {
  const catalog = compileCapabilityServiceCatalog({ substrate, capabilities });
  assert.deepEqual(catalog.capabilities.map((entry) => entry.capabilityId), capabilities.map((entry) => entry.capabilityId).sort());
  assert.equal(catalog.capabilities.find((entry) => entry.capabilityId === "runtime:external-ai").externalRuntimes[0].runtimeKey, "openai");
  assert.match(catalog.catalogHash, /^[a-f0-9]{64}$/);
});

test("every required service includes its declared prerequisite closure", () => {
  const fixtureCapabilities = capabilities.map((entry) => ({ ...entry, state: ["runtime:core", "runtime:build"].includes(entry.capabilityId) ? "active" : "disabled" }));
  const projection = resolveCapabilityServiceProjection({ substrate, capabilities: fixtureCapabilities, enabledRuntimeCapabilities: ["runtime:build"] });
  const required = new Set(projection.requiredServices);
  for (const requirement of projection.serviceRequirements) for (const dependency of requirement.dependsOn) assert.ok(required.has(dependency), `${requirement.service} prerequisite ${dependency} must be required`);
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

test("portal has no hard dependency on optional capability services", async () => {
  const [realSubstrate, realCapabilities] = await Promise.all([
    readFile(new URL("../platform-substrate-manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../packages/db/data/platform-runtime-capabilities.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const portal = realSubstrate.services.find((entry) => entry.service === "portal");
  assert.deepEqual(portal.dependsOn, ["portal-init"]);
  assert.doesNotThrow(() => compileCapabilityServiceCatalog({ substrate: realSubstrate, capabilities: realCapabilities.capabilities }));
});

test("closed substrate fields and array values are validated", () => {
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { ...substrate, services: [{ ...substrate.services[0], profiles: [42] }] }, capabilities }), /invalid_substrate_profiles:postgres/);
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { ...substrate, services: [{ ...substrate.services[0], backupPolicy: "sometimes" }] }, capabilities }), /invalid_substrate_service:postgres/);
  assert.throws(() => compileCapabilityServiceCatalog({ substrate: { ...substrate, externalRuntimes: [{ ...substrate.externalRuntimes[0], healthSemantics: "ping" }] }, capabilities }), /invalid_external_runtime:openai/);
});

test("activation policy values are closed", () => {
  const typo = capabilities.map((entry) => entry.capabilityId === "runtime:build" ? { ...entry, manifest: { runtime: { ...entry.manifest.runtime, activation: { policy: "operator_controlled" } } } } : entry);
  assert.throws(() => compileCapabilityServiceCatalog({ substrate, capabilities: typo }), /invalid_runtime_manifest:runtime:build/);
});

test("work guard values are closed and preserved in the catalog", () => {
  const guarded = capabilities.map((entry) => entry.capabilityId === "runtime:build"
    ? { ...entry, manifest: { runtime: { ...entry.manifest.runtime, workGuards: ["work-capsule:build-studio", "build-studio-active", "task-run:build"] } } }
    : entry);
  const catalog = compileCapabilityServiceCatalog({ substrate, capabilities: guarded });
  assert.deepEqual(catalog.capabilities.find((entry) => entry.capabilityId === "runtime:build").workGuards,
    ["build-studio-active", "task-run:build", "work-capsule:build-studio"]);
  const invalid = guarded.map((entry) => entry.capabilityId === "runtime:build"
    ? { ...entry, manifest: { runtime: { ...entry.manifest.runtime, workGuards: ["where:{status:not:ship}"] } } }
    : entry);
  assert.throws(() => compileCapabilityServiceCatalog({ substrate, capabilities: invalid }), /invalid_runtime_work_guard:runtime:build/);
});

test("host projection excludes services unsupported by the target host", () => {
  const hostSpecific = {
    ...substrate,
    services: substrate.services.map((entry) => entry.service === "dpf-stt"
      ? { ...entry, hostPlatforms: ["linux"] }
      : entry),
  };
  const enabled = new Set(["runtime:core", "runtime:local-speech"]);
  const fixtureCapabilities = capabilities.map((entry) => ({ ...entry, state: enabled.has(entry.capabilityId) ? "active" : "disabled" }));
  const windows = resolveCapabilityServiceProjection({ substrate: hostSpecific, capabilities: fixtureCapabilities, enabledRuntimeCapabilities: [...enabled], hostPlatform: "windows" });
  const linux = resolveCapabilityServiceProjection({ substrate: hostSpecific, capabilities: fixtureCapabilities, enabledRuntimeCapabilities: [...enabled], hostPlatform: "linux" });
  assert.ok(!windows.requiredServices.includes("dpf-stt"));
  assert.ok(linux.requiredServices.includes("dpf-stt"));
  assert.throws(() => resolveCapabilityServiceProjection({ substrate, capabilities: fixtureCapabilities, enabledRuntimeCapabilities: [...enabled], hostPlatform: "plan9" }), /invalid_host_platform:plan9/);
});

test("retirement is a declared lifecycle, kept honest against the enablement axis (BI-5AA0345E)", async () => {
  const substrate = JSON.parse(await readFile(new URL("../platform-substrate-manifest.json", import.meta.url), "utf8"));
  const seed = JSON.parse(await readFile(new URL("../../packages/db/data/platform-runtime-capabilities.json", import.meta.url), "utf8"));
  const withLifecycle = (id, patch) => ({
    ...seed,
    capabilities: seed.capabilities.map((c) => (c.capabilityId === id ? { ...c, ...patch } : c)),
  });

  // `state` is ENABLEMENT, `lifecycle` is LIFECYCLE. A capability the platform
  // withdrew cannot simultaneously be enabled — that contradiction is what would
  // make "operator turned it off" and "platform retired it" indistinguishable.
  assert.throws(
    () => compileCapabilityServiceCatalog({ substrate, capabilities: withLifecycle("runtime:local-speech", { lifecycle: "retired", state: "active" }).capabilities }),
    /retired_capability_still_active:runtime:local-speech/,
  );

  // The lifecycle axis is a closed set.
  assert.throws(
    () => compileCapabilityServiceCatalog({ substrate, capabilities: withLifecycle("runtime:local-speech", { lifecycle: "sunset" }).capabilities }),
    /invalid_runtime_lifecycle:runtime:local-speech/,
  );

  // A correctly declared retirement compiles and SURVIVES in the catalog, so an
  // install that still lists it can be migrated off rather than refused. If the
  // entry vanished instead, nothing could tell it from a tampered snapshot.
  const retired = compileCapabilityServiceCatalog({
    substrate,
    capabilities: withLifecycle("runtime:local-speech", { lifecycle: "retired", state: "disabled" }).capabilities,
  });
  const entry = retired.capabilities.find((c) => c.capabilityId === "runtime:local-speech");
  assert.ok(entry, "a retired capability must remain in the catalog for at least one release");
  assert.equal(entry.lifecycle, "retired");
});

test("lifecycle is emitted only when it carries information, so nothing is retired = no catalog churn", async () => {
  const substrate = JSON.parse(await readFile(new URL("../platform-substrate-manifest.json", import.meta.url), "utf8"));
  const seed = JSON.parse(await readFile(new URL("../../packages/db/data/platform-runtime-capabilities.json", import.meta.url), "utf8"));
  const catalog = compileCapabilityServiceCatalog({ substrate, capabilities: seed.capabilities });
  assert.ok(catalog.capabilities.every((c) => c.lifecycle === undefined),
    "no capability is retired today, so no entry should carry the field — a needless catalogHash move forces a migration on every install");
});
