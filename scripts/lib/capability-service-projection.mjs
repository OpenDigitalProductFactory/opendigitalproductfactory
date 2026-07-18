import { createHash } from "node:crypto";

const compare = (left, right) => left.localeCompare(right);
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
  ...(Array.isArray(record.hostPlatforms) ? { hostPlatforms: sortedStrings(record.hostPlatforms) } : {}),
  ...(Array.isArray(record.ports) ? { ports: sortedStrings(record.ports) } : {}),
  ...(Array.isArray(record.volumes) ? { volumes: sortedStrings(record.volumes) } : {}),
});
const canonicalRuntime = (record) => stable({
  ...record,
  ...(Array.isArray(record.hostPlatforms) ? { hostPlatforms: sortedStrings(record.hostPlatforms) } : {}),
});

function assertRecord(value, error) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
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
    const runtime = record.manifest?.runtime;
    if (!runtime || !Array.isArray(runtime.dependencies) || typeof runtime.activation?.policy !== "string") throw new Error(`invalid_runtime_manifest:${id}`);
    if (!runtime.dependencies.every((item) => typeof item === "string") || new Set(runtime.dependencies).size !== runtime.dependencies.length) throw new Error(`invalid_runtime_dependencies:${id}`);
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
    if (!Array.isArray(record.profiles) || !Array.isArray(record.dependsOn) || typeof record.defaultRequired !== "boolean") throw new Error(`invalid_substrate_service:${record.service}`);
    serviceByName.set(record.service, record);
  }
  for (const record of serviceByName.values()) for (const dependency of record.dependsOn) {
    if (!serviceByName.has(dependency)) throw new Error(`unknown_service_dependency:${record.service}:${dependency}`);
  }
  const runtimeKeys = new Set();
  for (const runtime of substrate.externalRuntimes) {
    if (typeof runtime.runtimeKey !== "string" || !runtime.runtimeKey) throw new Error("invalid_external_runtime");
    if (runtimeKeys.has(runtime.runtimeKey)) throw new Error(`duplicate_external_runtime:${runtime.runtimeKey}`);
    runtimeKeys.add(runtime.runtimeKey);
  }
  if (substrate.externalRuntimes.length && !capabilityById.has("runtime:external-ai")) throw new Error("missing_external_runtime_capability:runtime:external-ai");
  return { capabilityById, serviceByName };
}

export function compileCapabilityServiceCatalog(input) {
  const { substrate, capabilities } = input;
  const { capabilityById } = normalizeInputs(input);
  const entries = [...capabilityById.keys()].sort(compare).map((capabilityId) => {
    const record = capabilityById.get(capabilityId);
    return {
      capabilityId,
      dependencies: [...record.manifest.runtime.dependencies].sort(compare),
      activationPolicy: record.manifest.runtime.activation.policy,
      services: substrate.services.filter((item) => item.capability === capabilityId).sort((a, b) => compare(a.service, b.service)).map(canonicalService),
      externalRuntimes: capabilityId === "runtime:external-ai" ? [...substrate.externalRuntimes].sort((a, b) => compare(a.runtimeKey, b.runtimeKey)).map(canonicalRuntime) : [],
    };
  });
  const content = { catalogVersion: 1, substrateManifestVersion: substrate.version, capabilities: entries };
  return { ...content, catalogHash: hash(content) };
}

export function resolveCapabilityServiceProjection({ substrate, capabilities, enabledRuntimeCapabilities }) {
  if (!Array.isArray(enabledRuntimeCapabilities)) throw new Error("invalid_enabled_runtime_capabilities");
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
  const serviceRequirements = enabledEntries.flatMap((entry) => entry.services).sort((a, b) => compare(a.service, b.service));
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
    externalRuntimes: enabledEntries.flatMap((entry) => entry.externalRuntimes).sort((a, b) => compare(a.runtimeKey, b.runtimeKey)),
    composeProfiles: [...new Set(serviceRequirements.flatMap((entry) => entry.profiles))].sort(compare),
    backupServices: serviceRequirements.filter((entry) => entry.backupPolicy === "included" || entry.backupPolicy === "separate-required").map((entry) => entry.service).sort(compare),
    healthRequirements: serviceRequirements.filter((entry) => entry.healthSemantics !== "none").map((entry) => ({ service: entry.service, semantics: entry.healthSemantics })).sort((a, b) => compare(a.service, b.service)),
    serviceRequirements,
  };
}

export function serializeCapabilityServiceCatalog(catalog) {
  return bytes(catalog);
}
