import { createHash } from "node:crypto";

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const SERVICE_CLASSES = new Set(["universal-core", "capability-activated", "ephemeral-lifecycle", "separate-distribution", "test-development-only"]);
const BACKUP_POLICIES = new Set(["included", "separate-required", "excluded-ephemeral", "excluded-rebuildable", "excluded-stateless"]);
const HEALTH_SEMANTICS = new Set(["compose-healthcheck", "consumer-observed", "lifecycle-completion"]);
const HOST_PLATFORMS = new Set(["windows", "macos", "linux"]);
const EXTERNAL_KINDS = new Set(["ai-runtime"]);
const EXTERNAL_ACTIVATIONS = new Set(["provider-configuration"]);
const EXTERNAL_HEALTH_SEMANTICS = new Set(["provider-health-reconciliation"]);
const ACTIVATION_POLICIES = new Set(["always", "operator-controlled", "lifecycle-profile", "provider-configuration"]);
const WORK_GUARD_PATTERN = /^(build-studio-active|task-run:[a-z0-9-]+|work-capsule:[a-z0-9-]+)$/;
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, stable(value[key])]));
  return value;
};
const bytes = (value) => `${JSON.stringify(stable(value), null, 2)}\n`;
const hash = (value) => createHash("sha256").update(bytes(value)).digest("hex");
const sortedStrings = (values) => [...values].sort(compare);
const canonicalService = (record) => stable({
  ...record,
  profiles: sortedStrings(record.profiles),
  dependsOn: sortedStrings(record.dependsOn),
  hostPlatforms: sortedStrings(record.hostPlatforms),
  ports: sortedStrings(record.ports),
  volumes: sortedStrings(record.volumes),
});
const canonicalRuntime = (record) => stable({
  ...record,
  hostPlatforms: sortedStrings(record.hostPlatforms),
});

function assertRecord(value, error) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
}

function assertStringArray(value, error, allowed) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length || (allowed && value.some((item) => !allowed.has(item)))) throw new Error(error);
}

function normalizeInputs({ substrate, capabilities }) {
  assertRecord(substrate, "invalid_substrate_manifest");
  if (!Number.isInteger(substrate.version) || !Array.isArray(substrate.services) || !Array.isArray(substrate.externalRuntimes)) throw new Error("invalid_substrate_manifest");
  if (!Array.isArray(capabilities)) throw new Error("invalid_runtime_capabilities");

  const capabilityById = new Map();
  for (const record of capabilities) {
    assertRecord(record, "invalid_runtime_capability");
    const id = record.capabilityId;
    if (typeof id !== "string" || !id) throw new Error("invalid_runtime_capability_id");
    if (capabilityById.has(id)) throw new Error(`duplicate_runtime_capability:${id}`);
    if (record.state !== "active" && record.state !== "disabled") throw new Error(`invalid_runtime_state:${id}`);
    // `state` is the ENABLEMENT axis (is this capability turned on for this
    // install; tracked per-install in the DB). `lifecycle` is a separate
    // LIFECYCLE axis (does the platform still offer it at all). Conflating them
    // would make "the operator turned it off" indistinguishable from "the
    // platform retired it", which is the ambiguity that matters here.
    //
    // Retirement must be DECLARED, not inferred from a capability vanishing from
    // the seed: an install that still lists a vanished id cannot be told apart
    // from a tampered one, so it fails closed and can never upgrade again
    // (BI-5AA0345E). Retiring is therefore two-phase — mark it `retired` and
    // leave the entry in place for at least one release so every install can
    // migrate past it, and only then delete the entry.
    if (record.lifecycle !== undefined && record.lifecycle !== "active" && record.lifecycle !== "retired") throw new Error(`invalid_runtime_lifecycle:${id}`);
    if (record.lifecycle === "retired" && record.state === "active") throw new Error(`retired_capability_still_active:${id}`);
    const runtime = record.manifest?.runtime;
    if (!runtime || !Array.isArray(runtime.dependencies) || !ACTIVATION_POLICIES.has(runtime.activation?.policy)) throw new Error(`invalid_runtime_manifest:${id}`);
    if (!runtime.dependencies.every((item) => typeof item === "string") || new Set(runtime.dependencies).size !== runtime.dependencies.length) throw new Error(`invalid_runtime_dependencies:${id}`);
    if (id !== "runtime:core" && !Array.isArray(runtime.workGuards)) throw new Error(`missing_runtime_work_guards:${id}`);
    if (runtime.workGuards !== undefined && (!Array.isArray(runtime.workGuards) || new Set(runtime.workGuards).size !== runtime.workGuards.length || runtime.workGuards.some((guard) => typeof guard !== "string" || !WORK_GUARD_PATTERN.test(guard)))) throw new Error(`invalid_runtime_work_guard:${id}`);
    capabilityById.set(id, record);
  }
  for (const [id, record] of capabilityById) for (const dependency of record.manifest.runtime.dependencies) {
    if (!capabilityById.has(dependency)) throw new Error(`unknown_runtime_dependency:${id}:${dependency}`);
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path) => {
    if (visiting.has(id)) throw new Error(`capability_dependency_cycle:${[...path.slice(path.indexOf(id)), id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of capabilityById.get(id).manifest.runtime.dependencies) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...capabilityById.keys()].sort(compare)) visit(id, []);

  const serviceByName = new Map();
  for (const record of substrate.services) {
    assertRecord(record, "invalid_substrate_service");
    if (typeof record.service !== "string" || !record.service) throw new Error("invalid_substrate_service_name");
    if (serviceByName.has(record.service)) throw new Error(`duplicate_substrate_service:${record.service}`);
    if (!capabilityById.has(record.capability)) throw new Error(`unknown_service_capability:${record.service}:${record.capability}`);
    if (!SERVICE_CLASSES.has(record.class) || typeof record.defaultRequired !== "boolean" || !BACKUP_POLICIES.has(record.backupPolicy) || !HEALTH_SEMANTICS.has(record.healthSemantics) || typeof record.boundaryReason !== "string" || !record.boundaryReason || typeof record.canonicalDataOwner !== "string" || !record.canonicalDataOwner) throw new Error(`invalid_substrate_service:${record.service}`);
    assertStringArray(record.profiles, `invalid_substrate_profiles:${record.service}`);
    assertStringArray(record.dependsOn, `invalid_substrate_dependencies:${record.service}`);
    assertStringArray(record.ports, `invalid_substrate_ports:${record.service}`);
    assertStringArray(record.volumes, `invalid_substrate_volumes:${record.service}`);
    assertStringArray(record.hostPlatforms, `invalid_substrate_host_platforms:${record.service}`, HOST_PLATFORMS);
    serviceByName.set(record.service, record);
  }
  for (const record of [...serviceByName.values()].sort((a, b) => compare(a.service, b.service))) for (const dependency of sortedStrings(record.dependsOn)) {
    if (!serviceByName.has(dependency)) throw new Error(`unknown_service_dependency:${record.service}:${dependency}`);
    const targetCapability = serviceByName.get(dependency).capability;
    if (targetCapability !== record.capability) {
      const closure = new Set();
      const addDependencies = (id) => { for (const item of capabilityById.get(id).manifest.runtime.dependencies) if (!closure.has(item)) { closure.add(item); addDependencies(item); } };
      addDependencies(record.capability);
      if (!closure.has(targetCapability)) throw new Error(`undeclared_cross_capability_dependency:${record.service}:${dependency}:${record.capability}->${targetCapability}`);
    }
  }
  const runtimeKeys = new Set();
  for (const runtime of substrate.externalRuntimes) {
    assertRecord(runtime, "invalid_external_runtime");
    if (typeof runtime.runtimeKey !== "string" || !runtime.runtimeKey) throw new Error("invalid_external_runtime");
    if (runtimeKeys.has(runtime.runtimeKey)) throw new Error(`duplicate_external_runtime:${runtime.runtimeKey}`);
    if (!EXTERNAL_KINDS.has(runtime.kind) || !EXTERNAL_ACTIVATIONS.has(runtime.activation) || !EXTERNAL_HEALTH_SEMANTICS.has(runtime.healthSemantics) || typeof runtime.canonicalDataOwner !== "string" || !runtime.canonicalDataOwner || typeof runtime.boundaryReason !== "string" || !runtime.boundaryReason) throw new Error(`invalid_external_runtime:${runtime.runtimeKey}`);
    assertStringArray(runtime.hostPlatforms, `invalid_external_runtime_host_platforms:${runtime.runtimeKey}`, HOST_PLATFORMS);
    runtimeKeys.add(runtime.runtimeKey);
  }
  if (substrate.externalRuntimes.length && !capabilityById.has("runtime:external-ai")) throw new Error("missing_external_runtime_capability:runtime:external-ai");
  return { capabilityById, serviceByName };
}

export function compileCapabilityServiceCatalog(input) {
  const { substrate } = input;
  const { capabilityById } = normalizeInputs(input);
  const entries = [...capabilityById.keys()].sort(compare).map((capabilityId) => {
    const record = capabilityById.get(capabilityId);
    return {
      capabilityId,
      // Emitted only when it carries information: absent means active. Keeping
      // it out of the common case avoids moving catalogHash — and therefore
      // forcing a migration on every install — for a field nothing is using yet.
      ...(record.lifecycle === "retired" ? { lifecycle: "retired" } : {}),
      dependencies: [...record.manifest.runtime.dependencies].sort(compare),
      activationPolicy: record.manifest.runtime.activation.policy,
      workGuards: sortedStrings(record.manifest.runtime.workGuards ?? []),
      services: substrate.services.filter((item) => item.capability === capabilityId).sort((a, b) => compare(a.service, b.service)).map(canonicalService),
      externalRuntimes: capabilityId === "runtime:external-ai" ? [...substrate.externalRuntimes].sort((a, b) => compare(a.runtimeKey, b.runtimeKey)).map(canonicalRuntime) : [],
    };
  });
  const content = { catalogVersion: 1, substrateManifestVersion: substrate.version, capabilities: entries };
  return { ...content, catalogHash: hash(content) };
}

export function resolveCapabilityServiceProjection({ substrate, capabilities, enabledRuntimeCapabilities, hostPlatform }) {
  if (!Array.isArray(enabledRuntimeCapabilities)) throw new Error("invalid_enabled_runtime_capabilities");
  if (hostPlatform !== undefined && !HOST_PLATFORMS.has(hostPlatform)) throw new Error(`invalid_host_platform:${hostPlatform}`);
  const { capabilityById } = normalizeInputs({ substrate, capabilities });
  const catalog = compileCapabilityServiceCatalog({ substrate, capabilities });
  const enabled = new Set();
  const add = (id) => {
    if (!capabilityById.has(id)) throw new Error(`unknown_runtime_capability:${id}`);
    if (enabled.has(id)) return;
    for (const dependency of capabilityById.get(id).manifest.runtime.dependencies) add(dependency);
    enabled.add(id);
  };
  for (const id of enabledRuntimeCapabilities) add(id);
  for (const [id, record] of capabilityById) if (record.manifest.runtime.activation.policy === "always") add(id);
  const enabledKeys = [...enabled].sort(compare);
  const liveEnabledKeys = [...capabilityById].filter(([, record]) => record.state === "active").map(([id]) => id).sort(compare);
  if (JSON.stringify(liveEnabledKeys) !== JSON.stringify(enabledKeys)) throw new Error("capability_state_stale");
  const enabledEntries = catalog.capabilities.filter((entry) => enabled.has(entry.capabilityId));
  const enabledServices = enabledEntries.flatMap((entry) => entry.services)
    .filter((entry) => hostPlatform === undefined || entry.hostPlatforms.includes(hostPlatform));
  const enabledServiceByName = new Map(enabledServices.map((entry) => [entry.service, entry]));
  const selected = new Set();
  const include = (serviceName) => {
    if (selected.has(serviceName)) return;
    const entry = enabledServiceByName.get(serviceName);
    if (!entry) throw new Error(`required_service_outside_enabled_capability_closure:${serviceName}`);
    selected.add(serviceName);
    for (const dependency of entry.dependsOn) include(dependency);
  };
  const isOnDemandLifecycle = (entry) => entry.targetClassification === "ephemeral-lifecycle"
    && entry.profiles.length > 0
    && capabilityById.get(entry.capability).manifest.runtime.activation.policy !== "operator-controlled";
  for (const entry of enabledServices) if (!isOnDemandLifecycle(entry)) include(entry.service);
  const serviceRequirements = [...selected].sort(compare).map((serviceName) => enabledServiceByName.get(serviceName));
  const requiredServices = serviceRequirements.map((entry) => entry.service);
  const requiredSet = new Set(requiredServices);
  const stateLines = [...capabilityById].map(([id, record]) => `${id}=${record.state}`).sort(compare).join("\n");
  const capabilityStateVersion = createHash("sha256").update(`${catalog.catalogHash}\n${stateLines}`).digest("hex");
  return {
    catalogVersion: catalog.catalogVersion,
    catalogHash: catalog.catalogHash,
    capabilityStateVersion,
    enabledRuntimeCapabilities: enabledKeys,
    requiredServices,
    inactiveOptionalServices: substrate.services.map((entry) => entry.service).filter((name) => !requiredSet.has(name)).sort(compare),
    externalRuntimes: enabledEntries.flatMap((entry) => entry.externalRuntimes)
      .filter((entry) => hostPlatform === undefined || entry.hostPlatforms.includes(hostPlatform))
      .sort((a, b) => compare(a.runtimeKey, b.runtimeKey)),
    composeProfiles: [...new Set(serviceRequirements.flatMap((entry) => entry.profiles))].sort(compare),
    backupServices: serviceRequirements.filter((entry) => entry.backupPolicy === "included" || entry.backupPolicy === "separate-required").map((entry) => entry.service).sort(compare),
    healthRequirements: serviceRequirements.filter((entry) => entry.healthSemantics !== "none").map((entry) => ({ service: entry.service, semantics: entry.healthSemantics })).sort((a, b) => compare(a.service, b.service)),
    serviceRequirements,
  };
}

export function serializeCapabilityServiceCatalog(catalog) {
  return bytes(catalog);
}
