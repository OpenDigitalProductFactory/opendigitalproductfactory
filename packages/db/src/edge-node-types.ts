// Type re-exports + invariant helpers for the Phase 0 Edge Node models.
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md
//
// Application code (A2 onwards) imports the Prisma-generated types from
// here so the import surface is stable even if the Prisma client output
// path changes.

import type {
  BootstrapToken,
  EdgeNode,
  EdgeNodeCapability,
} from "../generated/client/client";

export type { BootstrapToken, EdgeNode, EdgeNodeCapability };

// Allowed string-literal values for the enum-shaped columns. Kept as
// const arrays so they can be used both at type-check time and at
// runtime (e.g. Zod schemas in A2).

export const EDGE_NODE_PLATFORMS = ["darwin", "win32", "linux"] as const;
export type EdgeNodePlatform = (typeof EDGE_NODE_PLATFORMS)[number];

export const EDGE_NODE_INSTALL_MODES = [
  "native",
  "container-host",
  "container-vm",
] as const;
export type EdgeNodeInstallMode = (typeof EDGE_NODE_INSTALL_MODES)[number];

export const EDGE_NODE_STATUSES = [
  "pending",
  "active",
  "offline",
  "quarantined",
] as const;
export type EdgeNodeStatus = (typeof EDGE_NODE_STATUSES)[number];

export const EDGE_NODE_TRUST_STATES = [
  "pending",
  "trusted",
  "quarantined",
  "revoked",
] as const;
export type EdgeNodeTrustState = (typeof EDGE_NODE_TRUST_STATES)[number];

export const EDGE_NODE_CAPABILITY_MODES = [
  "enabled",
  "reporting-only",
  "disabled",
] as const;
export type EdgeNodeCapabilityMode =
  (typeof EDGE_NODE_CAPABILITY_MODES)[number];

export const EDGE_NODE_CAPABILITY_STATUSES = [
  "healthy",
  "degraded",
  "failing",
  "unknown",
] as const;
export type EdgeNodeCapabilityStatus =
  (typeof EDGE_NODE_CAPABILITY_STATUSES)[number];

// Phase 0 ships only this single capability. Reserved capability strings
// from the spec § Edge Node capability envelope are not yet acceptable.
export const PHASE_0_CAPABILITIES = ["discovery.network"] as const;
export type Phase0Capability = (typeof PHASE_0_CAPABILITIES)[number];

// All capability strings the spec reserves; A2's accepted-capabilities
// negotiation rejects anything outside this set.
export const RESERVED_CAPABILITIES = [
  "discovery.network",
  // Native host DNS-SD advertise/browse for nearby DPF setup suggestions.
  // Discovery candidates are never identity or trust evidence.
  "federation.discovery",
  "discovery.software",
  "metrics.host",
  // Network telemetry adapters — spec: 2026-05-19-edge-node-network-telemetry-adapters-design.md
  "metrics.network",
  "discovery.lldp",
  // Detection engine — spec: 2026-05-21-edge-event-envelope-design.md (BI-9FE9D48D).
  // Slice 0: edge emits PD-CEF-style events to POST /api/v1/edge/events.
  "events.emit",
  "identity.broker",
  "mcp.gateway",
  "a2a.gateway",
  "policy.enforcement",
  "tunnel.private-link",
  // EP-REMOTE-ACTION P2: governed remote-action execution. Default OFF — NOT in
  // PHASE_0_CAPABILITIES, so enrollment never auto-accepts it; an operator enables
  // it per-node, action-type allow-listed, before any read-only diagnostics
  // dispatch. Threat model §5 R3 (docs/.../2026-06-25-remote-action-edge-dispatch-threat-model.md).
  "action.execute",
] as const;
export type ReservedCapability = (typeof RESERVED_CAPABILITIES)[number];

// Capabilities a runtime may request during enrollment. This is deliberately
// narrower than RESERVED_CAPABILITIES: sensitive future capabilities remain
// operator-configured rather than becoming enabled merely by advertisement.
export const EDGE_NODE_ENROLLMENT_CAPABILITIES = [
  ...PHASE_0_CAPABILITIES,
  "federation.discovery",
] as const;
export type EdgeNodeEnrollmentCapability =
  (typeof EDGE_NODE_ENROLLMENT_CAPABILITIES)[number];

// Token namespace prefixes (mirrors the dpfmcp_/dpfedge_/dpfboot_ family).
export const EDGE_NODE_TOKEN_PREFIX = "dpfedge_";
export const BOOTSTRAP_TOKEN_PREFIX = "dpfboot_";

// Token TTL constants per spec § Token namespaces and lifecycle.
export const BOOTSTRAP_TOKEN_DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min
export const BOOTSTRAP_TOKEN_MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const NODE_TOKEN_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h refresh

// PrincipalAlias kind for EdgeNode identity convergence
// (per AGENTS.md §11 principal-convergence rule).
export const EDGE_NODE_ALIAS_KIND = "edge_node";

// ── Invariant predicates ─────────────────────────────────────────────────────
// These guard the EdgeNode lifecycle state machine. A2 (the API layer)
// uses them to refuse operations that would put a row in an invalid
// state. Pure functions; no DB access.

/**
 * A BootstrapToken is consumed iff both `consumedAt` and
 * `consumedByEdgeNodeId` are set, and never reset to null thereafter
 * (single-use semantics).
 */
export function isBootstrapTokenConsumed(token: BootstrapToken): boolean {
  return token.consumedAt !== null && token.consumedByEdgeNodeId !== null;
}

/**
 * A BootstrapToken is usable for enrollment iff it is not consumed,
 * not revoked, and not past its expiresAt.
 */
export function isBootstrapTokenUsable(
  token: BootstrapToken,
  now: Date = new Date(),
): boolean {
  if (isBootstrapTokenConsumed(token)) return false;
  if (token.revokedAt !== null) return false;
  if (token.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Per spec, an EdgeNode in `trustState: trusted` MUST have a non-null
 * `approvedAt`. The converse is not required: a node can be approved
 * (approvedAt set) and then quarantined (trustState moves on).
 */
export function isEdgeNodeApprovalConsistent(node: EdgeNode): boolean {
  if (node.trustState === "trusted") {
    return node.approvedAt !== null;
  }
  return true;
}

/**
 * Per spec, a `revoked` EdgeNode MUST have a non-null `revokedAt`.
 * Submissions from revoked nodes are rejected at the auth-middleware
 * layer in A2.
 */
export function isEdgeNodeRevocationConsistent(node: EdgeNode): boolean {
  if (node.trustState === "revoked") {
    return node.revokedAt !== null;
  }
  return true;
}

/**
 * A node may submit observations only when trustState is "trusted".
 * "pending" nodes can heartbeat (so operators see them) but cannot
 * yet submit. "quarantined" nodes can heartbeat but submissions are
 * dropped at the application layer (we keep the row alive for forensic
 * inspection rather than refusing the connection).
 */
export function canEdgeNodeSubmitObservations(node: EdgeNode): boolean {
  return node.trustState === "trusted";
}

/**
 * The token is valid auth material iff the node has a tokenHash, is not
 * revoked, and the trust state is not `pending` (pending nodes can
 * enroll but not yet authenticate further requests).
 */
export function canEdgeNodeAuthenticateRequest(node: EdgeNode): boolean {
  if (node.tokenHash === null) return false;
  if (node.trustState === "revoked") return false;
  if (node.revokedAt !== null) return false;
  return true;
}
