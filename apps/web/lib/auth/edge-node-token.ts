// Bearer-token validation middleware for the /api/v1/edge/* routes.
//
// Resolves a presented Authorization: Bearer dpfedge_<secret> against
// the EdgeNode.tokenHash column. Refuses tokens for nodes whose
// trustState is `revoked`, or whose row carries a non-null
// `revokedAt`. Returns an unbranded ResolvedEdgeNodeAuth handle that
// the route handlers use to attribute writes.
//
// This module must NEVER:
//   - Log or echo the plaintext token.
//   - Mutate EdgeNode rows (lastSeenAt updates happen in the heartbeat
//     business module so the contract is explicit).
//   - Allow scope check to pass on a quarantined node for
//     `discovery:submit` (the route layer enforces the drop, but this
//     middleware surfaces the trustState so the route knows to drop).
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Token model, § Quarantine, § Revocation.

import { prisma } from "@dpf/db";
import { canEdgeNodeAuthenticateRequest } from "@dpf/db/edge-node-types";

import { classifyTokenPrefix, hashToken } from "@/lib/edge-node/tokens";

export type ResolveEdgeNodeAuthFailure = {
  ok: false;
  error:
    | "missing_authorization"
    | "invalid_scheme"
    | "invalid_token_format"
    | "token_not_found"
    | "node_revoked"
    | "scope_disallowed";
  message: string;
};

export type ResolvedEdgeNodeAuth = {
  ok: true;
  /** EdgeNode.id (the cuid surrogate). */
  edgeNodeRowId: string;
  /** EdgeNode.nodeId (the stable external identifier). */
  nodeId: string;
  trustState: "pending" | "trusted" | "quarantined" | "revoked";
};

export type EdgeNodeScope =
  | "edge:heartbeat"
  | "edge:metrics"
  | "edge:events"
  | "edge:rotate"
  | "edge:adapters"
  | "discovery:submit";

/**
 * Resolve a Bearer Authorization header to an EdgeNode auth handle.
 *
 * Per spec § Token namespaces and lifecycle:
 *   - `pending` trustState may auth + heartbeat (so operator sees them)
 *   - `trusted` trustState may auth + heartbeat + submit
 *   - `quarantined` trustState may auth + heartbeat (so operator sees
 *     they're alive); routes drop submissions
 *   - `revoked` trustState rejects all auth
 */
export async function resolveEdgeNodeAuth(
  authorizationHeader: string | null | undefined,
  requiredScope: EdgeNodeScope,
): Promise<ResolvedEdgeNodeAuth | ResolveEdgeNodeAuthFailure> {
  if (!authorizationHeader) {
    return {
      ok: false,
      error: "missing_authorization",
      message: "Authorization header is required",
    };
  }

  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader.trim());
  if (!match) {
    return {
      ok: false,
      error: "invalid_scheme",
      message: "Authorization must use the Bearer scheme",
    };
  }
  const presented = match[1]?.trim();
  if (!presented) {
    return {
      ok: false,
      error: "invalid_scheme",
      message: "Bearer token is empty",
    };
  }

  if (classifyTokenPrefix(presented) !== "node") {
    return {
      ok: false,
      error: "invalid_token_format",
      message: "Edge Node tokens must use the dpfedge_ prefix",
    };
  }

  const presentedHash = hashToken(presented);
  const node = await prisma.edgeNode.findUnique({
    where: { tokenHash: presentedHash },
  });

  if (!node) {
    return {
      ok: false,
      error: "token_not_found",
      message: "Edge Node token does not match any active node",
    };
  }

  if (!canEdgeNodeAuthenticateRequest(node)) {
    return {
      ok: false,
      error: "node_revoked",
      message: "Edge Node has been revoked or has no valid token material",
    };
  }

  // Per-scope refinement. discovery:submit, edge:metrics, edge:events, and
  // edge:adapters all require trustState=trusted (pending and quarantined
  // nodes can heartbeat but cannot submit observations, send metrics, emit
  // events, or read adapter credentials).
  if (
    (requiredScope === "discovery:submit" ||
      requiredScope === "edge:metrics" ||
      requiredScope === "edge:events" ||
      requiredScope === "edge:adapters") &&
    node.trustState !== "trusted"
  ) {
    return {
      ok: false,
      error: "scope_disallowed",
      message: `Edge Node trust state '${node.trustState}' cannot access scope '${requiredScope}'`,
    };
  }

  return {
    ok: true,
    edgeNodeRowId: node.id,
    nodeId: node.nodeId,
    trustState: node.trustState as ResolvedEdgeNodeAuth["trustState"],
  };
}
