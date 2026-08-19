import { readFile as nativeReadFile, readdir as nativeReaddir } from "node:fs/promises";
import { join } from "node:path";
import {
  listModuleSourcePaths,
  MODULE_SIZE_SOFT_CEILING,
  moduleSizesFromSources,
  readModuleSources,
} from "./module-size-scope.mjs";

export const SUPPORTED_MANIFEST_VERSION = 2;
export const SUBSTRATE_CLASSES = [
  "universal-core",
  "ephemeral-lifecycle",
  "capability-activated",
  "test-development-only",
  "separate-distribution",
];

const SPECIALIST_CLASSES = new Set(SUBSTRATE_CLASSES.slice(1));
export const CANONICAL_DATA_OWNERS = [
  "none", "postgres", "sandbox-postgres", "dev-postgres", "redis",
  "postgres-and-redis", "prometheus", "grafana", "loki",
  "browser-evidence", "browser-profiles", "tts-voices",
];
export const BACKUP_POLICIES = [
  "included", "separate-required", "excluded-ephemeral",
  "excluded-rebuildable", "excluded-stateless",
];
export const HEALTH_SEMANTICS = [
  "compose-healthcheck", "consumer-observed", "lifecycle-completion",
  "provider-health-reconciliation",
];
export const HOST_PLATFORMS = ["windows", "macos", "linux"];
export const EXTERNAL_RUNTIME_KINDS = ["ai-runtime"];
export const EXTERNAL_RUNTIME_ACTIVATIONS = ["provider-configuration"];
const REQUIRED_SERVICE_FIELDS = [
  "capability",
  "canonicalDataOwner",
  "backupPolicy",
  "healthSemantics",
  "hostPlatforms",
  "targetClassification",
];
const REQUIRED_RUNTIME_FIELDS = [
  "kind",
  "activation",
  "canonicalDataOwner",
  "healthSemantics",
  "hostPlatforms",
  "boundaryReason",
];

function lineCount(content) {
  return content.replace(/\r\n?/g, "\n").split("\n").length;
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedObject(value[key])]));
  }
  return value;
}

export function stableSerialize(value) {
  return `${JSON.stringify(sortedObject(value), null, 2)}\n`;
}

const RATCHET_DIRECTIONS = ["non-increasing", "informational"];

const STATIC_RATCHET_METRICS = [
  ["defaultRequiredServiceCount", "non-increasing", (measurement) => measurement.services.defaultRequired],
  ["directInngestImportCount", "non-increasing", (measurement) => measurement.directInngestImports.length],
  ["integrationConnectRouteCount", "non-increasing", (measurement) => measurement.integrationConnectRoutes.length],
  ["prismaModelCount", "non-increasing", (measurement) => measurement.prismaModelCount],
  ["prismaSchemaLines", "informational", (measurement) => measurement.lineCounts.prismaSchema],
  ["productionModuleHotspotCount", "non-increasing", (measurement) => measurement.productionModulesAboveSoftCeiling.length],
  ["providerConnectionStateProjectorCount", "non-increasing", (measurement) => measurement.providerConnectionStateProjectors.length],
  ["seedCoordinatorLines", "informational", (measurement) => measurement.lineCounts.seedCoordinator],
  ["serviceCount", "non-increasing", (measurement) => measurement.services.total],
];

export function buildStaticRatchetMetrics(measurement) {
  return Object.fromEntries(STATIC_RATCHET_METRICS.map(([name, direction, read]) => [
    name,
    { direction, value: read(measurement) },
  ]));
}

function validateRatchetMetric(name, metric, source) {
  if (!metric || !RATCHET_DIRECTIONS.includes(metric.direction)) {
    throw new Error(`${source} metric ${name} must declare direction as ${RATCHET_DIRECTIONS.join(" or ")}`);
  }
  if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) {
    throw new Error(`${source} metric ${name} must have a finite numeric value`);
  }
}

export function compareRatchetMetrics({ baseline, current }) {
  const baselineNames = Object.keys(baseline ?? {}).sort();
  const currentNames = Object.keys(current ?? {}).sort();
  if (baselineNames.length === 0 || currentNames.length === 0) {
    throw new Error("Ratchet metric inventories must be non-empty");
  }
  const baselineOnly = baselineNames.filter((name) => !Object.hasOwn(current, name));
  const currentOnly = currentNames.filter((name) => !Object.hasOwn(baseline, name));
  if (baselineOnly.length > 0 || currentOnly.length > 0) {
    throw new Error(`Ratchet metric inventories must match; baseline only: ${baselineOnly.join(", ") || "none"}; current only: ${currentOnly.join(", ") || "none"}`);
  }
  const regressions = [];
  const advisories = [];
  for (const name of baselineNames) {
    const baselineMetric = baseline[name];
    validateRatchetMetric(name, baselineMetric, "Baseline");
    const currentMetric = current?.[name];
    validateRatchetMetric(name, currentMetric, "Current");
    if (currentMetric.direction !== baselineMetric.direction) {
      throw new Error(`Current metric ${name} direction must match the baseline direction`);
    }
    if (baselineMetric.direction === "informational") continue;
    if (currentMetric.value > baselineMetric.value) {
      regressions.push({
        metric: name,
        baseline: baselineMetric.value,
        current: currentMetric.value,
      });
    } else if (currentMetric.value < baselineMetric.value) {
      advisories.push({
        metric: name,
        baseline: baselineMetric.value,
        current: currentMetric.value,
        message: `${name} improved; update the stale baseline`,
      });
    }
  }
  return { passed: regressions.length === 0, regressions, advisories };
}

function hasDirectInngestImport(content) {
  const specifiers = [
    ...content.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g),
    ...content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  return specifiers.some((specifier) => specifier === "inngest"
    || specifier.startsWith("inngest/")
    || /(?:^|\/)queue\/inngest-client$/.test(specifier));
}

function isApprovedInngestPath(path) {
  return path === "apps/web/app/api/inngest/route.ts"
    || path.startsWith("apps/web/lib/execution/adapters/")
    || path.startsWith("apps/web/lib/queue/");
}

async function readRequired(repoRoot, path, readFile) {
  try {
    return await readFile(join(repoRoot, ...path.split("/")), "utf8");
  } catch (error) {
    throw new Error(`Unable to read required repository file ${path}`, { cause: error });
  }
}

// The Prisma schema is a folder of domain files (packages/db/prisma/schema/*.prisma,
// B5 Seam C split); read them concatenated in sorted filename order — the same
// recursive load order the Prisma CLI uses — so model/line counts stay text-level.
async function readRequiredPrismaSchema(repoRoot, readFile) {
  const relativeDir = "packages/db/prisma/schema";
  let names;
  try {
    names = await nativeReaddir(join(repoRoot, ...relativeDir.split("/")));
  } catch (error) {
    throw new Error(`Unable to read required repository file ${relativeDir}`, { cause: error });
  }
  const parts = [];
  for (const name of names.filter((entry) => entry.endsWith(".prisma")).sort()) {
    parts.push(await readRequired(repoRoot, `${relativeDir}/${name}`, readFile));
  }
  if (parts.length === 0) {
    throw new Error(`Unable to read required repository file ${relativeDir} (no *.prisma files)`);
  }
  return parts.join("\n");
}

export async function collectRepositoryMeasurements({
  repoRoot,
  manifest,
  generatedAt,
  gitSha,
  io = {},
}) {
  const readFile = io.readFile ?? nativeReadFile;
  const files = await listModuleSourcePaths({ repoRoot, readdir: io.readdir });
  const contents = await readModuleSources({ repoRoot, paths: files, readFile });
  const sizes = moduleSizesFromSources(contents);
  const schemaContent = await readRequiredPrismaSchema(repoRoot, readFile);
  const seedContent = await readRequired(repoRoot, "packages/db/src/seed.ts", readFile);
  const services = Array.isArray(manifest?.services) ? manifest.services : [];
  const byClass = {};
  for (const service of services) byClass[service.class] = (byClass[service.class] ?? 0) + 1;

  return {
    generatedAt,
    gitSha,
    services: {
      total: services.length,
      defaultRequired: services.filter((service) => service.defaultRequired).length,
      byClass: sortedObject(byClass),
    },
    prismaModelCount: [...schemaContent.matchAll(/^model\s+[A-Za-z_]\w*\s*\{/gm)].length,
    directInngestImports: files.filter((path) => !isApprovedInngestPath(path) && hasDirectInngestImport(contents.get(path))),
    integrationConnectRoutes: files.filter((path) => /^apps\/web\/app\/api\/integrations\/.+\/connect\/route\.ts$/.test(path)),
    providerConnectionStateProjectors: files.filter((path) => /^apps\/web\/lib\/integrate\/[^/]+\/connection-state\.ts$/.test(path)),
    productionModulesAboveSoftCeiling: files
      .map((path) => ({ lines: sizes[path], path }))
      .filter(({ lines }) => lines > MODULE_SIZE_SOFT_CEILING)
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    lineCounts: {
      prismaSchema: lineCount(schemaContent),
      seedCoordinator: lineCount(seedContent),
    },
  };
}

function indentation(line) {
  return line.match(/^ */)[0].length;
}

function valueWithoutComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    } else if (char === "#" && !quote && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trim();
    }
  }
  return value.trim();
}

function unquote(value) {
  const clean = valueWithoutComment(value);
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    return clean.slice(1, -1);
  }
  return clean;
}

function parseInlineList(value, context) {
  const clean = valueWithoutComment(value);
  if (!clean.startsWith("[") || !clean.endsWith("]")) {
    throw new Error(`Unsupported Compose ${context}: expected an inline list`);
  }
  const inner = clean.slice(1, -1).trim();
  return inner ? inner.split(",").map((item) => unquote(item.trim())) : [];
}

function collectList(lines, start, propertyIndent, context) {
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = indentation(line);
    if (indent <= propertyIndent) break;
    const match = line.match(/^\s*-\s+(.+)$/);
    if (!match) throw new Error(`Unsupported Compose ${context}: expected scalar list entries`);
    values.push(unquote(match[1]));
  }
  return values;
}

function parseAnchoredLists(lines) {
  const anchors = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*[\w.-]+:\s*&([\w.-]+)\s*$/);
    if (!match) continue;
    const nextContent = lines.slice(index + 1).find((line) => line.trim() && !line.trimStart().startsWith("#"));
    if (nextContent && indentation(nextContent) > indentation(lines[index]) && /^\s*-\s+/.test(nextContent)) {
      anchors.set(match[1], collectList(lines, index, indentation(lines[index]), `anchor ${match[1]}`));
    }
  }
  return anchors;
}

function findServicesBlock(lines) {
  const start = lines.findIndex((line) => /^services:\s*(?:#.*)?$/.test(line));
  if (start < 0) throw new Error("Unsupported Compose structure: missing top-level services mapping");
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_.-]+:\s*/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

export function parseComposeServices(composeText) {
  if (typeof composeText !== "string") throw new TypeError("Compose content must be a string");
  const lines = composeText.replace(/\r\n?/g, "\n").split("\n");
  const anchors = parseAnchoredLists(lines);
  const { start, end } = findServicesBlock(lines);
  const services = [];

  for (let index = start + 1; index < end; index += 1) {
    const serviceMatch = lines[index].match(/^  ([A-Za-z0-9_.-]+):\s*(.*?)\s*$/);
    if (!serviceMatch) continue;
    const [, service, trailing] = serviceMatch;
    if (valueWithoutComment(trailing)) {
      throw new Error(`Unsupported Compose service structure for ${service}: expected a mapping`);
    }
    const record = { service, profiles: [], ports: [], volumes: [], dependsOn: [] };
    let serviceEnd = end;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      if (/^  [A-Za-z0-9_.-]+:\s*/.test(lines[cursor])) {
        serviceEnd = cursor;
        break;
      }
    }
    for (let cursor = index + 1; cursor < serviceEnd; cursor += 1) {
      const property = lines[cursor].match(/^    (profiles|ports|volumes|depends_on):\s*(.*?)\s*$/);
      if (!property) continue;
      const [, key, rawValue] = property;
      const target = key === "depends_on" ? "dependsOn" : key;
      const value = valueWithoutComment(rawValue);
      if (value.startsWith("[")) record[target] = parseInlineList(value, `${service}.${key}`);
      else if (value.startsWith("*")) {
        const resolved = anchors.get(value.slice(1));
        if (!resolved) throw new Error(`Unsupported Compose ${service}.${key}: unknown alias ${value}`);
        record[target] = [...resolved];
      } else if (value) {
        throw new Error(`Unsupported Compose ${service}.${key}: expected a list or mapping`);
      } else if (key === "depends_on") {
        const dependencies = [];
        for (let child = cursor + 1; child < serviceEnd; child += 1) {
          if (!lines[child].trim() || lines[child].trimStart().startsWith("#")) continue;
          const indent = indentation(lines[child]);
          if (indent <= 4) break;
          const dependency = lines[child].match(/^      ([A-Za-z0-9_.-]+):(?:\s|$)/);
          if (dependency) dependencies.push(dependency[1]);
          else if (/^\s*-\s+/.test(lines[child])) dependencies.push(unquote(lines[child].replace(/^\s*-\s+/, "")));
        }
        record.dependsOn = dependencies;
      } else {
        record[target] = collectList(lines, cursor, 4, `${service}.${key}`);
      }
    }
    services.push(record);
    index = serviceEnd - 1;
  }
  return services;
}

function parseComposeRuntimeHosts(composeText) {
  const lines = composeText.replace(/\r\n?/g, "\n").split("\n");
  const { start, end } = findServicesBlock(lines);
  const hosts = new Set();
  for (let index = start + 1; index < end; index += 1) {
    const serviceMatch = lines[index].match(/^  ([A-Za-z0-9_.-]+):\s*(?:#.*)?$/);
    if (!serviceMatch) continue;
    const service = serviceMatch[1];
    let serviceEnd = end;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      if (/^  [A-Za-z0-9_.-]+:\s*/.test(lines[cursor])) {
        serviceEnd = cursor;
        break;
      }
    }
    for (let cursor = index + 1; cursor < serviceEnd; cursor += 1) {
      const environment = lines[cursor].match(/^    environment:\s*(.*?)\s*$/);
      if (!environment) continue;
      if (valueWithoutComment(environment[1])) {
        if (/LLM_BASE_URL/.test(environment[1])) throw new Error(`Unsupported Compose ${service}.environment runtime declaration`);
        continue;
      }
      for (let child = cursor + 1; child < serviceEnd; child += 1) {
        if (!lines[child].trim() || lines[child].trimStart().startsWith("#")) continue;
        if (indentation(lines[child]) <= 4) break;
        const mapping = lines[child].match(/^      LLM_BASE_URL:\s*(.+)$/);
        const sequence = lines[child].match(/^      -\s+LLM_BASE_URL=(.+)$/);
        const declaration = mapping?.[1] ?? sequence?.[1];
        if (!declaration) continue;
        const url = unquote(declaration).match(/https?:\/\/([^/:}]+)/i);
        if (!url) throw new Error(`Unsupported Compose ${service}.environment LLM_BASE_URL declaration`);
        hosts.add(url[1].toLowerCase());
      }
    }
    index = serviceEnd - 1;
  }
  return [...hosts];
}

export function enumerateExternalRuntimes({ providers, composeText }) {
  const runtimes = new Set((providers ?? []).map((provider) => provider.providerId));
  for (const host of parseComposeRuntimeHosts(composeText)) runtimes.add(host);
  return [...runtimes].sort();
}

function sameStringSet(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function isPresent(value) {
  return Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

function validateEnum(errors, service, field, value, allowed) {
  if (!allowed.includes(value)) errors.push(`${service}: ${field} has unsupported value ${value}`);
}

function validateHostPlatforms(errors, service, platforms) {
  if (!Array.isArray(platforms) || platforms.length === 0 || platforms.some((platform) => !HOST_PLATFORMS.includes(platform)) || new Set(platforms).size !== platforms.length) {
    errors.push(`${service}: hostPlatforms must be a non-empty unique subset of ${HOST_PLATFORMS.join(", ")}`);
  }
}

export function validateSubstrateManifest(manifest, { composeText, overlayComposeTexts = [], providers = [], capabilities }) {
  const errors = [];
  if (!Number.isInteger(manifest?.version) || manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    errors.push(`Manifest version must be the supported positive integer ${SUPPORTED_MANIFEST_VERSION}`);
  }
  const composeServices = parseComposeServices(composeText);
  const composeServiceNames = new Set(composeServices.map(({ service }) => service));
  for (const overlayText of overlayComposeTexts) for (const service of parseComposeServices(overlayText)) {
    if (!composeServiceNames.has(service.service)) { composeServices.push(service); composeServiceNames.add(service.service); }
  }
  const records = Array.isArray(manifest?.services) ? manifest.services : [];
  const seen = new Set();

  for (const record of records) {
    if (seen.has(record.service)) errors.push(`Duplicate service record: ${record.service}`);
    seen.add(record.service);
    if (!SUBSTRATE_CLASSES.includes(record.class)) errors.push(`${record.service}: unknown class ${record.class}`);
    if (SPECIALIST_CLASSES.has(record.class) && !isPresent(record.boundaryReason)) errors.push(`${record.service}: boundaryReason is required for specialist services`);
    for (const field of REQUIRED_SERVICE_FIELDS) {
      if (!isPresent(record[field])) errors.push(`${record.service}: ${field} is required`);
    }
    validateEnum(errors, record.service, "canonicalDataOwner", record.canonicalDataOwner, CANONICAL_DATA_OWNERS);
    validateEnum(errors, record.service, "backupPolicy", record.backupPolicy, BACKUP_POLICIES);
    validateEnum(errors, record.service, "healthSemantics", record.healthSemantics, HEALTH_SEMANTICS);
    validateHostPlatforms(errors, record.service, record.hostPlatforms);
    validateEnum(errors, record.service, "targetClassification", record.targetClassification, SUBSTRATE_CLASSES);
    if (typeof record.defaultRequired !== "boolean") errors.push(`${record.service}: defaultRequired must be boolean`);
  }

  const byService = new Map(records.map((record) => [record.service, record]));
  for (const actual of composeServices) {
    const expected = byService.get(actual.service);
    if (!expected) {
      errors.push(`Compose service ${actual.service} is absent from the manifest`);
      continue;
    }
    for (const field of ["profiles", "ports", "volumes", "dependsOn"]) {
      if (!Array.isArray(expected[field]) || !sameStringSet(actual[field], expected[field])) {
        errors.push(`${actual.service}: ${field} does not match Compose`);
      }
    }
    const composeStartsByDefault = actual.profiles.length === 0;
    if (expected.defaultRequired !== composeStartsByDefault) {
      errors.push(`${actual.service}: defaultRequired does not match Compose profile activation`);
    }
  }
  for (const record of records) {
    if (!composeServices.some(({ service }) => service === record.service)) errors.push(`Manifest service ${record.service} is absent from Compose`);
  }

  const runtimeRecords = Array.isArray(manifest?.externalRuntimes) ? manifest.externalRuntimes : [];
  const runtimeKeys = new Set();
  for (const runtime of runtimeRecords) {
    if (runtimeKeys.has(runtime.runtimeKey)) errors.push(`Duplicate external runtime record: ${runtime.runtimeKey}`);
    runtimeKeys.add(runtime.runtimeKey);
    for (const field of REQUIRED_RUNTIME_FIELDS) {
      if (!isPresent(runtime[field])) errors.push(`${runtime.runtimeKey}: ${field} is required`);
    }
    validateEnum(errors, runtime.runtimeKey, "kind", runtime.kind, EXTERNAL_RUNTIME_KINDS);
    validateEnum(errors, runtime.runtimeKey, "activation", runtime.activation, EXTERNAL_RUNTIME_ACTIVATIONS);
    validateEnum(errors, runtime.runtimeKey, "canonicalDataOwner", runtime.canonicalDataOwner, CANONICAL_DATA_OWNERS);
    validateEnum(errors, runtime.runtimeKey, "healthSemantics", runtime.healthSemantics, HEALTH_SEMANTICS);
    validateHostPlatforms(errors, runtime.runtimeKey, runtime.hostPlatforms);
  }
  const expectedRuntimeKeys = [...new Set([
    ...(providers ?? []).map((provider) => provider.providerId),
    ...[composeText, ...overlayComposeTexts].flatMap((source) => enumerateExternalRuntimes({ providers: [], composeText: source })),
  ])].sort();
  for (const runtimeKey of expectedRuntimeKeys) {
    if (!runtimeKeys.has(runtimeKey)) errors.push(`External runtime ${runtimeKey} is absent from the manifest`);
  }
  for (const runtimeKey of runtimeKeys) {
    if (!expectedRuntimeKeys.includes(runtimeKey)) errors.push(`Manifest external runtime ${runtimeKey} is absent from providers and Compose`);
  }
  if (capabilities) {
    errors.push(...validateCapabilityServiceBindings({
      services: records,
      capabilities,
      composeServiceNames: composeServices.map(({ service }) => service),
    }));
  }
  return errors;
}

export function validateCapabilityServiceBindings({ services, capabilities, composeServiceNames }) {
  const errors = [];
  const capabilityIds = new Set((capabilities ?? []).map(({ capabilityId }) => capabilityId));
  const knownServices = composeServiceNames ? new Set(composeServiceNames) : null;
  const serviceCounts = new Map();
  for (const record of services ?? []) {
    serviceCounts.set(record.service, (serviceCounts.get(record.service) ?? 0) + 1);
    if (!capabilityIds.has(record.capability)) errors.push(`missing_capability:${record.capability}`);
    if (knownServices && !knownServices.has(record.service)) errors.push(`unknown_service_binding:${record.service}`);
  }
  for (const [service, count] of serviceCounts) {
    if (count > 1) errors.push(`duplicate_service_binding:${service}`);
  }
  return [...new Set(errors)].sort();
}
