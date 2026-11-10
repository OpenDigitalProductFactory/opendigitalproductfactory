// EP-MSP-FEDERATION · B3 + B5 — federated record sync reconciliation
// (BI-3179B48E / BI-E2398997). Pure decision core for the generic
// FederatedRecordMirror: given the current mirror state and an incoming update,
// decide create / update / noop / conflict. The canonical record always stays
// on its source side; only the canonical side may mutate, so a non-canonical
// write is a conflict, not a silent overwrite. Plus the B5 organization
// crosswalk — an explicit ref pairing, never an email/name merge.

export const FEDERATED_RECORD_TYPES = [
  "incident",
  "service-ticket",
  "organization-crosswalk",
  "demand-envelope",
  // Work coordination across same-organization installs. A development
  // companion is created and destroyed repeatedly; without these two types the
  // backlog it produced dies with it.
  "backlog-item",
  "epic",
  // Read-only operational-posture rollup: each install is canonical for its own
  // posture and projects a minimized, read-only summary to same-organization peers.
  "operational-posture",
] as const;
export type FederatedRecordType = (typeof FEDERATED_RECORD_TYPES)[number];

export type CanonicalSide = "local" | "peer";
export type MirrorSyncStatus = "pending" | "synced" | "conflict" | "withdrawn" | "dead-letter" | "revoked";

export interface MirrorState {
  version: number;
  syncStatus: MirrorSyncStatus;
  /** Which side holds the canonical record and is therefore allowed to mutate. */
  canonicalSide: CanonicalSide;
  payloadHash?: string | null;
}

export interface IncomingMirrorUpdate {
  /** Which side this update came from. */
  fromSide: CanonicalSide;
  /** The version the sender based its update on (optimistic concurrency). */
  baseVersion: number;
  payloadHash: string;
}

export type MirrorDecision =
  | { action: "create" }
  | { action: "update"; nextVersion: number }
  | { action: "noop" }
  | { action: "conflict"; reason: string };

export function reconcileMirror(
  existing: MirrorState | null,
  incoming: IncomingMirrorUpdate,
): MirrorDecision {
  if (!existing) return { action: "create" };
  if (existing.syncStatus === "revoked") return { action: "conflict", reason: "link-revoked" };
  // Only the canonical side may mutate; a non-canonical writer is a conflict.
  if (incoming.fromSide !== existing.canonicalSide) {
    return { action: "conflict", reason: "non-canonical-writer" };
  }
  if (existing.payloadHash != null && incoming.payloadHash === existing.payloadHash) {
    return { action: "noop" };
  }
  // Optimistic concurrency: the sender must be based on the current version.
  if (incoming.baseVersion !== existing.version) {
    return { action: "conflict", reason: "stale-base-version" };
  }
  return { action: "update", nextVersion: existing.version + 1 };
}

// ── B5 organization crosswalk (explicit ref, never an email/name merge) ───────

export interface OrganizationCrosswalk {
  recordType: "organization-crosswalk";
  /** Our id for the relationship (CustomerAccount.accountId or Organization.orgId). */
  localOrgRef: string;
  /** The peer's org identifier. */
  peerOrgRef: string;
}

export function buildOrganizationCrosswalk(
  localOrgRef: string,
  peerOrgRef: string,
): OrganizationCrosswalk {
  if (!localOrgRef || !peerOrgRef) {
    // Refuse to fabricate a crosswalk from partial identity — the partner-spec
    // §6.2 discipline: link records explicitly, do not merge by email/name.
    throw new Error("organization crosswalk requires explicit refs on both sides");
  }
  return { recordType: "organization-crosswalk", localOrgRef, peerOrgRef };
}
