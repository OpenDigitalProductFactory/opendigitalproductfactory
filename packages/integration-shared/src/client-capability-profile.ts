/**
 * The client capability profile (BI-64795FD0): what each agent client can do,
 * per verified version, with evidence. One source,
 * `packages/dpf-skill-pack/client-capabilities.json`; this module reads its
 * generated copy. Every rule that depends on a client capability reads it here:
 * the MCP credential policy, the toolchain floor and the release manifest.
 */
import { clientVersionUnverified, type ClientCapabilityRow } from "./client-capability-rules.cjs";
import { CLIENT_CAPABILITY_PROFILE } from "./client-capability-profile.generated";

export { CLIENT_CAPABILITY_PROFILE };
export {
  capabilityPresent,
  clientVersionUnverified,
  compareClientVersions,
  extractClientVersion,
} from "./client-capability-rules.cjs";
export type {
  CapabilityField,
  CapabilityStatus,
  ClientCapabilityProfile,
  ClientCapabilityRow,
  HookEventState,
  HookHost,
  HookHostRecord,
} from "./client-capability-rules.cjs";

/** The profile row for a client kind (e.g. "claude-code"), or null when the profile has none. */
export function clientCapabilityRow(clientKind: string): ClientCapabilityRow | null {
  return Object.hasOwn(CLIENT_CAPABILITY_PROFILE.clients, clientKind)
    ? CLIENT_CAPABILITY_PROFILE.clients[clientKind]!
    : null;
}

export type ClientVersionCheck = {
  clientKind: string;
  clientVersion: string;
  /** The newest version the profile was proven on; null when nothing is verified. */
  verifiedVersion: string | null;
  unverified: boolean;
};

/**
 * Whether a reported client version is newer than the profile has verified.
 * A client kind the profile does not list is never flagged: it is not a DPF client.
 */
export function checkClientVersion(clientKind: string, clientVersion: string): ClientVersionCheck {
  const row = clientCapabilityRow(clientKind);
  return {
    clientKind,
    clientVersion,
    verifiedVersion: row?.verifiedVersion ?? null,
    unverified: row ? clientVersionUnverified(row, clientVersion) : false,
  };
}
