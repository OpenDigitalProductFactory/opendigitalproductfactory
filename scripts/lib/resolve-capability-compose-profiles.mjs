#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { governCapabilityComposeEnvironment } from "./govern-capability-compose-args.mjs";
import { computeCapabilityStateVersion } from "./capability-state-hash.mjs";

const HOSTS = new Set(["windows", "macos", "linux"]);
const OVERLAYS = new Set(["promote", "dev", "integration-test", "linux-monitoring"]);
const ALIASES = new Map([
  ["tts", "runtime:local-speech"],
  ["observability-ui", "runtime:deep-observability"],
]);
export const PRE_PROFILE_COMPATIBILITY_CAPABILITIES = Object.freeze([
  "runtime:browser-automation",
  "runtime:build",
  "runtime:core",
  "runtime:deep-observability",
  "runtime:durable-automation",
  // Provider configuration was active before profiles. It has no local service
  // on Windows/macOS, but retaining it keeps install and live DB state aligned.
  "runtime:external-ai",
  "runtime:local-speech",
]);

const sortedUnique = (values) => [...new Set(values)].sort();
export function resolveCapabilityComposeProfiles({ catalog, state, hostPlatform, overlays = [], aliases = [], composeProfiles = "", migrate = false }) {
  if (!catalog || !Array.isArray(catalog.capabilities) || typeof catalog.catalogHash !== "string") throw new Error("invalid_capability_service_catalog");
  if (hostPlatform !== undefined && !HOSTS.has(hostPlatform)) throw new Error(`invalid_host_platform:${hostPlatform}`);
  const byId = new Map(catalog.capabilities.map((entry) => [entry.capabilityId, entry]));
  const legacy = !Array.isArray(state?.enabledRuntimeCapabilities);
  const incompleteSnapshot = !legacy
    && (state.enabledRuntimeCapabilities.length > 0 || state.capabilityCatalogHash || state.capabilityStateVersion)
    && (!state.capabilityCatalogHash || !state.capabilityStateVersion);
  if (incompleteSnapshot) throw new Error("capability_state_stale");
  const unversioned = legacy || (!state.capabilityCatalogHash && !state.capabilityStateVersion);
  if (unversioned && !migrate) throw new Error("capability_state_stale");
  const requested = legacy ? [...PRE_PROFILE_COMPATIBILITY_CAPABILITIES] : [...state.enabledRuntimeCapabilities];
  for (const alias of aliases) {
    const capability = ALIASES.get(alias);
    if (!capability) throw new Error(`unknown_compose_profile_alias:${alias}`);
    requested.push(capability);
  }
  // Retirement, split by CAUSE — the same split the catalog-hash axis needed,
  // for the same reason: the two look identical in a membership test and are
  // opposite in meaning.
  //
  //   declared retired    the platform's own doing, on its own release. The
  //                       entry is still in the catalog saying so, and this is
  //                       what --migrate is for: drop it and restamp. Refusing
  //                       wedges every install that had it enabled, and the
  //                       upgrade that would drop it IS the blocked upgrade.
  //   absent entirely     nothing vouches for this id. Could be a corrupt or
  //                       hand-edited snapshot, so it still fails closed even
  //                       under --migrate.
  //
  // Without --migrate a declared retirement is still a refusal: the snapshot is
  // genuinely stale and the caller has not asked to rewrite it (BI-5AA0345E).
  const retired = new Set(catalog.capabilities.filter((entry) => entry.lifecycle === "retired").map((entry) => entry.capabilityId));
  const droppedRetired = [];
  const enabled = new Set();
  const visit = (id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`unknown_runtime_capability:${id}`);
    if (enabled.has(id)) return;
    for (const dependency of entry.dependencies ?? []) visit(dependency);
    enabled.add(id);
  };
  for (const id of requested) {
    if (retired.has(id)) {
      if (!migrate) throw new Error("capability_state_stale");
      if (!droppedRetired.includes(id)) droppedRetired.push(id);
      continue;
    }
    visit(id);
  }
  for (const entry of catalog.capabilities) if (entry.activationPolicy === "always" && !retired.has(entry.capabilityId)) visit(entry.capabilityId);
  // A retired capability reached as a DEPENDENCY of a live one is a catalog
  // authoring error, not an install's problem — surface it rather than shipping
  // a projection that silently depends on something the platform withdrew.
  for (const id of enabled) if (retired.has(id)) throw new Error(`retired_runtime_capability_required:${id}`);
  const enabledRuntimeCapabilities = sortedUnique(enabled);
  const capabilityStateVersion = computeCapabilityStateVersion(catalog.catalogHash, enabledRuntimeCapabilities, catalog.capabilities.map(({ capabilityId }) => capabilityId));
  // Reconciliation, split by CAUSE — because the two look identical in a hash
  // comparison and are opposite in meaning.
  //
  // A CATALOG change is the platform's own doing: shipping a release that adds
  // or moves a service moves `catalogHash`, and every already-installed state
  // then carries the previous one. That is precisely what `--migrate` is for,
  // and refusing it wedges every pre-existing install — the upgrade that would
  // restamp the state IS the blocked upgrade. (Observed: a release moving
  // `inngest` into `runtime:core` failed promoter readiness with
  // `capability_projection_failed` on an otherwise healthy install. The same
  // self-wedging shape is called out for host identity in promote.sh.)
  //
  // A STATE-VERSION change with an UNCHANGED catalog is not the platform's
  // doing: the enabled set was edited without restamping. Migration must never
  // paper over that, so it still fails closed even under `--migrate`.
  if (!unversioned) {
    const catalogMoved = state.capabilityCatalogHash !== catalog.catalogHash;
    if (catalogMoved) {
      if (!migrate) throw new Error("capability_state_stale");
    } else if (state.capabilityStateVersion !== capabilityStateVersion) {
      throw new Error("capability_state_stale");
    }
  }
  for (const overlay of overlays) if (!OVERLAYS.has(overlay)) throw new Error(`unknown_lifecycle_profile:${overlay}`);

  const entries = enabledRuntimeCapabilities.map((id) => byId.get(id));
  const serviceBindings = entries.flatMap((entry) => (entry.services ?? []).map((service) => ({ entry, service })))
    .filter(({ service }) => !hostPlatform || service.hostPlatforms?.includes(hostPlatform));
  const services = serviceBindings.map(({ service }) => service);
  const requiredServices = sortedUnique(serviceBindings.filter(({ entry, service }) => !(
    service.targetClassification === "ephemeral-lifecycle"
      && service.profiles.length > 0
      && entry.activationPolicy !== "operator-controlled"
  )).map(({ service }) => service.service));
  const runtimeProfiles = sortedUnique(services.flatMap((service) => service.profiles ?? []).filter((profile) => profile.startsWith("runtime-")));
  const overlayProfiles = sortedUnique(overlays);
  const governed = governCapabilityComposeEnvironment({
    args: [],
    projection: { runtimeProfiles },
    composeProfiles: [...runtimeProfiles, ...overlayProfiles, composeProfiles].filter(Boolean).join(","),
  });
  const governedOverlayProfiles = governed.composeProfiles.filter((profile) => !runtimeProfiles.includes(profile));
  return {
    enabledRuntimeCapabilities,
    // Non-empty only under --migrate, so a caller can report what the platform
    // withdrew rather than have capabilities disappear from the install silently.
    droppedRetiredCapabilities: droppedRetired.sort(),
    capabilityCatalogHash: catalog.catalogHash,
    capabilityStateVersion,
    runtimeProfiles,
    overlayProfiles: governedOverlayProfiles,
    composeProfiles: governed.composeProfiles,
    requiredServices,
  };
}

function parseArgs(argv) {
  const result = { overlays: [], aliases: [], migrate: false, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--state") result.statePath = argv[++index];
    else if (arg === "--catalog") result.catalogPath = argv[++index];
    else if (arg === "--host") result.hostPlatform = argv[++index];
    else if (arg === "--overlay") result.overlays.push(argv[++index]);
    else if (arg === "--alias") result.aliases.push(argv[++index]);
    else if (arg === "--compose-profiles") result.composeProfiles = argv[++index] ?? "";
    else if (arg === "--migrate") result.migrate = true;
    else if (arg === "--write") result.write = true;
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (!result.statePath) throw new Error("missing_install_state");
  return result;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const catalogPath = resolve(args.catalogPath ?? resolve(scriptRoot, "capability-service-catalog.generated.json"));
    const statePath = resolve(args.statePath);
    const [catalog, state] = await Promise.all([
      readFile(catalogPath, "utf8").then(JSON.parse),
      readFile(statePath, "utf8").then((text) => JSON.parse(text.replace(/^\uFEFF/, ""))),
    ]);
    if (!args.hostPlatform) {
      args.hostPlatform = state.platform === "win32" ? "windows" : state.platform === "darwin" ? "macos" : state.platform;
    }
    let projection = resolveCapabilityComposeProfiles({ catalog, state, ...args });
    if (args.write) {
      const { updateInstallState } = await import("../installer/install-state-transaction.mjs");
      await updateInstallState(statePath, current => {
        projection = resolveCapabilityComposeProfiles({ catalog, state: current, ...args });
        return { ...current, enabledRuntimeCapabilities: projection.enabledRuntimeCapabilities, capabilityCatalogHash: projection.capabilityCatalogHash, capabilityStateVersion: projection.capabilityStateVersion };
      });
    }
    process.stdout.write(`${JSON.stringify(projection)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
