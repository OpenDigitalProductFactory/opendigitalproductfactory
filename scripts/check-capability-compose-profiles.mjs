#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveCapabilityServiceProjection } from "./lib/capability-service-projection.mjs";

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sorted = (values) => [...values].sort(compare);
const capabilityProfile = (capability) => capability.replace(":", "-");

function parseInlineList(value) {
  const source = value.trim();
  if (!source.startsWith("[") || !source.endsWith("]")) throw new Error(`unsupported_compose_profile_syntax:${source}`);
  return source.slice(1, -1).split(",").map((entry) => entry.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

export function parseComposeServices(source) {
  const services = new Map();
  let inServices = false;
  let current;
  let inDependsOn = false;
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    if (!inServices) {
      if (line === "services:") inServices = true;
      continue;
    }
    if (/^[^\s#][^:]*:/.test(line)) break;
    const serviceMatch = /^  ([a-zA-Z0-9][a-zA-Z0-9_-]*):\s*$/.exec(line);
    if (serviceMatch) {
      current = { service: serviceMatch[1], profiles: [], dependsOn: [], hasProfiles: false, hasDependsOn: false };
      services.set(current.service, current);
      inDependsOn = false;
      continue;
    }
    if (!current) continue;
    const propertyMatch = /^    ([a-zA-Z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (propertyMatch) {
      inDependsOn = propertyMatch[1] === "depends_on";
      if (propertyMatch[1] === "profiles") { current.profiles = parseInlineList(propertyMatch[2] ?? ""); current.hasProfiles = true; }
      if (propertyMatch[1] === "depends_on") current.hasDependsOn = true;
      continue;
    }
    if (inDependsOn) {
      const dependencyMatch = /^      ([a-zA-Z0-9][a-zA-Z0-9_-]*):\s*$/.exec(line);
      if (dependencyMatch) current.dependsOn.push(dependencyMatch[1]);
      else if (/^    \S/.test(line)) inDependsOn = false;
    }
  }
  return services;
}

function mergeComposeServices(base, overlay) {
  const merged = new Map([...base].map(([name, service]) => [name, { ...service, profiles: [...service.profiles], dependsOn: [...service.dependsOn] }]));
  for (const [name, service] of overlay) {
    const current = merged.get(name);
    merged.set(name, current ? {
      ...current,
      profiles: service.hasProfiles ? [...service.profiles] : current.profiles,
      dependsOn: service.hasDependsOn ? [...new Set([...current.dependsOn, ...service.dependsOn])] : current.dependsOn,
      hasProfiles: current.hasProfiles || service.hasProfiles,
      hasDependsOn: current.hasDependsOn || service.hasDependsOn,
    } : { ...service, profiles: [...service.profiles], dependsOn: [...service.dependsOn] });
  }
  return merged;
}

export async function loadCapabilityProfileFixture(url) {
  const values = {};
  for (const rawLine of (await readFile(url, "utf8")).replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`invalid_capability_profile_fixture:${line}`);
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return {
    enabledRuntimeCapabilities: (values.DPF_ENABLED_RUNTIME_CAPABILITIES ?? "").split(",").filter(Boolean),
    composeProfiles: (values.COMPOSE_PROFILES ?? "").split(",").filter(Boolean),
    hostPlatform: values.DPF_HOST_PLATFORM || undefined,
  };
}

function withFixtureStates(capabilities, enabledRuntimeCapabilities) {
  const enabled = new Set(enabledRuntimeCapabilities);
  return capabilities.map((record) => ({ ...record, state: enabled.has(record.capabilityId) ? "active" : "disabled" }));
}

function selectedComposeServices(services, profiles) {
  const activeProfiles = new Set(profiles);
  const selected = new Set([...services.values()].filter((service) => service.profiles.length === 0 || service.profiles.some((profile) => activeProfiles.has(profile))).map((service) => service.service));
  const includeDependencies = (name) => {
    const service = services.get(name);
    if (!service) throw new Error(`unknown_compose_dependency:${name}`);
    for (const dependency of service.dependsOn) if (!selected.has(dependency)) {
      selected.add(dependency);
      includeDependencies(dependency);
    }
  };
  for (const name of [...selected]) includeDependencies(name);
  return sorted(selected);
}

export function checkCapabilityComposeProfiles({ composeSource, overlaySources = {}, substrate, capabilities, catalog }) {
  const services = parseComposeServices(composeSource);
  const hostServices = {
    windows: services,
    macos: mergeComposeServices(services, parseComposeServices(overlaySources.macos ?? "services:\n")),
    linux: mergeComposeServices(services, parseComposeServices(overlaySources.linux ?? "services:\n")),
  };
  const errors = [];
  const manifestByName = new Map(substrate.services.map((service) => [service.service, service]));
  for (const record of substrate.services) {
    const compose = services.get(record.service) ?? record.hostPlatforms.map((host) => hostServices[host]?.get(record.service)).find(Boolean);
    if (!compose) { errors.push(`missing_compose_service:${record.service}`); continue; }
    const capabilityActivated = record.capability !== "runtime:core" && (record.class === "capability-activated" || record.capability === "runtime:build");
    if (capabilityActivated && (compose.profiles.length === 0 || record.defaultRequired)) errors.push(`default_started_optional_service:${record.service}`);
    const portable = record.hostPlatforms.length === 3;
    if (capabilityActivated && portable && !compose.profiles.includes(capabilityProfile(record.capability))) errors.push(`missing_capability_profile:${record.service}:${capabilityProfile(record.capability)}`);
    if (record.defaultRequired !== (compose.profiles.length === 0)) errors.push(`default_required_mismatch:${record.service}`);
    if (JSON.stringify(sorted(record.profiles)) !== JSON.stringify(sorted(compose.profiles))) errors.push(`compose_profile_mismatch:${record.service}`);
    if (JSON.stringify(sorted(record.dependsOn)) !== JSON.stringify(sorted(compose.dependsOn))) errors.push(`compose_dependency_mismatch:${record.service}`);
  }
  for (const [host, inventory] of Object.entries(hostServices)) for (const name of inventory.keys()) if (!manifestByName.has(name)) errors.push(`missing_substrate_binding:${host}:${name}`);
  for (const inventory of Object.values(hostServices)) for (const service of inventory.values()) for (const dependencyName of service.dependsOn) {
    const dependency = inventory.get(dependencyName);
    if (!dependency || dependency.profiles.length === 0) continue;
    if (service.profiles.length === 0) errors.push(`core_dependency_on_optional_profile:${service.service}:${dependencyName}`);
    for (const profile of service.profiles) if (!dependency.profiles.includes(profile)) {
      errors.push(`profile_dependency_unreachable:${service.service}:${dependencyName}:${profile}`);
    }
  }

  const resolveFixture = (fixture, hostOverride) => {
    if (!capabilities || !catalog) throw new Error("fixture_resolution_requires_catalog_authorities");
    const runtimeCapabilities = withFixtureStates(capabilities, fixture.enabledRuntimeCapabilities);
    const hostPlatform = hostOverride ?? fixture.hostPlatform;
    const projection = resolveCapabilityServiceProjection({ substrate, capabilities: runtimeCapabilities, enabledRuntimeCapabilities: fixture.enabledRuntimeCapabilities, hostPlatform });
    if (projection.catalogHash !== catalog.catalogHash) throw new Error("stale_capability_service_catalog");
    if (JSON.stringify(projection.composeProfiles) !== JSON.stringify(sorted(fixture.composeProfiles))) throw new Error(`fixture_profile_mismatch:${projection.composeProfiles.join(",")}:${fixture.composeProfiles.join(",")}`);
    return { composeServices: selectedComposeServices(hostServices[hostPlatform] ?? services, fixture.composeProfiles), projectedServices: sorted(projection.requiredServices) };
  };
  const renderProfiles = (hostPlatform, profiles) => selectedComposeServices(hostServices[hostPlatform] ?? services, profiles);
  return { errors: [...new Set(errors)], services, hostServices, resolveFixture, renderProfiles };
}

async function main() {
  const [composeSource, macosOverlay, linuxOverlay, substrateSource, capabilitiesSource, catalogSource] = await Promise.all([
    readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.macos.yml", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.linux.yml", import.meta.url), "utf8"),
    readFile(new URL("./platform-substrate-manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../packages/db/data/platform-runtime-capabilities.json", import.meta.url), "utf8"),
    readFile(new URL("./capability-service-catalog.generated.json", import.meta.url), "utf8"),
  ]);
  const result = checkCapabilityComposeProfiles({ composeSource, overlaySources: { macos: macosOverlay, linux: linuxOverlay }, substrate: JSON.parse(substrateSource), capabilities: JSON.parse(capabilitiesSource).capabilities, catalog: JSON.parse(catalogSource) });
  for (const name of ["core", "build", "local-speech", "deep-observability", "external-ai"]) {
    const fixture = await loadCapabilityProfileFixture(new URL(`./fixtures/capability-profiles/${name}.env`, import.meta.url));
    const rendered = result.resolveFixture(fixture);
    if (JSON.stringify(rendered.composeServices) !== JSON.stringify(rendered.projectedServices)) result.errors.push(`fixture_service_closure_mismatch:${name}:${rendered.composeServices.join(",")}:${rendered.projectedServices.join(",")}`);
  }
  for (const name of ["deep-observability-linux", "external-ai-linux"]) {
    const linuxFixture = await loadCapabilityProfileFixture(new URL(`./fixtures/capability-profiles/${name}.env`, import.meta.url));
    const linuxRendered = result.resolveFixture(linuxFixture);
    if (JSON.stringify(linuxRendered.composeServices) !== JSON.stringify(linuxRendered.projectedServices)) result.errors.push(`fixture_service_closure_mismatch:${name}:${linuxRendered.composeServices.join(",")}:${linuxRendered.projectedServices.join(",")}`);
  }
  if (result.errors.length) throw new Error(result.errors.join("\n"));
  process.stdout.write("capability_compose_profiles_ok\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
