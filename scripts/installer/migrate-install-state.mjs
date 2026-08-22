#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCapabilityComposeProfiles } from "../lib/resolve-capability-compose-profiles.mjs";
import { parseAndValidateInstallStateBytes, validateInstallState } from "./validate-install-state.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const projectedBytes = (state) => Buffer.from(`${JSON.stringify(state, null, 2)}\n`);

export async function projectInstallState({ bytes, hostIdentity, catalog }) {
  if (!hostIdentity) throw new Error("host_identity_required");
  if (!catalog) throw new Error("capability_catalog_required");
  const sourceBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const parsed = await parseAndValidateInstallStateBytes(sourceBytes);
  if (!parsed.valid) throw new Error(parsed.errors.join(", "));
  const source = parsed.value;
  if (source.platform !== "unsupported" && source.platform !== hostIdentity.platform) throw new Error("host_identity_contradictory");
  const canonicalSourceArch = new Map([["x64", "amd64"], ["amd64", "amd64"], ["x86_64", "x86_64"], ["arm64", "arm64"]]).get(source.arch);
  if ((source.schemaVersion === 2 || canonicalSourceArch) && canonicalSourceArch !== hostIdentity.arch) throw new Error("host_identity_contradictory");

  // This function IS the migrator, so it always resolves in migrate mode. The
  // catalog moves whenever a release adds or moves a service, which leaves the
  // previous hash on every already-installed state — restamping that is the
  // whole job. Migrate mode still fails closed on the causes migration must
  // never paper over: a snapshot that disagrees with an UNCHANGED catalog, and
  // a capability the candidate catalog no longer defines.
  //
  // Gating this on `schemaVersion === 1` wedged every live install instead: a
  // v2 state took the strict path, so the first release to move the catalog
  // failed promoter readiness with `capability_state_stale`, and the upgrade
  // that would have restamped the state WAS the blocked upgrade (BI-AA6FBAD0,
  // live run SUR-C45B5F4B).
  const capability = resolveCapabilityComposeProfiles({
    catalog,
    state: source,
    hostPlatform: hostIdentity.capabilityHostPlatform,
    migrate: true,
  });
  const projectedCapability = {
    enabledRuntimeCapabilities: capability.enabledRuntimeCapabilities,
    capabilityCatalogHash: capability.capabilityCatalogHash,
    capabilityStateVersion: capability.capabilityStateVersion,
  };
  const projectedState = source.schemaVersion === 2
    ? { ...source, ...projectedCapability }
    : { ...source, schemaVersion: 2, platform: hostIdentity.platform, arch: hostIdentity.arch, ...projectedCapability };
  const validated = await validateInstallState(projectedState);
  if (!validated.valid) throw new Error(validated.errors.join(", "));
  // A catalog move is a real migration even though the schema version does not
  // change, so `migrationRequired` tracks the projected capability snapshot as
  // well. Without this the restamp is recomputed on every single upgrade and
  // never persisted, because the promoter only writes when this flag is set.
  const capabilityMoved = Object.entries(projectedCapability)
    .some(([key, value]) => JSON.stringify(source[key]) !== JSON.stringify(value));
  return {
    sourceHash: sha256(sourceBytes),
    projectionHash: sha256(projectedBytes(projectedState)),
    migrationRequired: source.schemaVersion !== 2 || capabilityMoved,
    projectedState,
  };
}

function parseArgs(argv) {
  const args = { write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") args.write = true;
    else if (["--state", "--catalog", "--host-platform", "--host-arch", "--recovery-path", "--expected-source-hash", "--expected-projection-hash"].includes(arg)) args[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index];
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (!args.state || !args.catalog || !args.hostPlatform || !args.hostArch) throw new Error("migration_arguments_required");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [bytes, catalog] = await Promise.all([readFile(args.state), readFile(args.catalog, "utf8").then(JSON.parse)]);
  const platform = new Map([["windows", "win32"], ["macos", "darwin"]]).get(args.hostPlatform) ?? args.hostPlatform;
  const capabilityHostPlatform = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : platform;
  const result = await projectInstallState({ bytes, catalog, hostIdentity: { platform, arch: args.hostArch, capabilityHostPlatform, provenance: "installer" } });
  if (args.expectedSourceHash && args.expectedSourceHash !== result.sourceHash) throw new Error("install_state_envelope_state_changed");
  if (args.expectedProjectionHash && args.expectedProjectionHash !== result.projectionHash) throw new Error("install_state_projection_mismatch");
  if (args.write && result.migrationRequired) {
    const { updateInstallState } = await import("./install-state-transaction.mjs");
    await updateInstallState(args.state, () => result.projectedState, {
      expectedSourceSha256: result.sourceHash,
      recoveryPath: args.recoveryPath,
    });
  }
  process.stdout.write(`${JSON.stringify({ sourceHash: result.sourceHash, projectionHash: result.projectionHash, migrationRequired: result.migrationRequired })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 2; });
