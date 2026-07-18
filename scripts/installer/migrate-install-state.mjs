import { createHash } from "node:crypto";

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

  const capability = resolveCapabilityComposeProfiles({
    catalog,
    state: source,
    hostPlatform: hostIdentity.capabilityHostPlatform,
    migrate: source.schemaVersion === 1,
  });
  const projectedState = source.schemaVersion === 2 ? source : {
    ...source,
    schemaVersion: 2,
    platform: hostIdentity.platform,
    arch: hostIdentity.arch,
    enabledRuntimeCapabilities: capability.enabledRuntimeCapabilities,
    capabilityCatalogHash: capability.capabilityCatalogHash,
    capabilityStateVersion: capability.capabilityStateVersion,
  };
  const validated = await validateInstallState(projectedState);
  if (!validated.valid) throw new Error(validated.errors.join(", "));
  return {
    sourceHash: sha256(sourceBytes),
    projectionHash: sha256(projectedBytes(projectedState)),
    migrationRequired: source.schemaVersion !== 2,
    projectedState,
  };
}
