// Bearer-token auth for the /api/v1/edge/* routes.
//
// Wraps `resolveNodeToken` with the request-level concerns the spec lists:
//   - Authorization: Bearer dpfedge_… extraction
//   - scope membership check
//   - EdgeNode trust-state gate (revoked → 401; quarantined → 403 unless
//     the call is a heartbeat, in which case it's allowed so operators
//     can see the node is alive)
//   - audit-log ready return shape: tokenId, edgeNodeId, trustState
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// (Token namespaces and lifecycle + Approval policy + Quarantine).

import { prisma } from "@dpf/db";
import type { NextRequest } from "next/server";

import {
  resolveNodeToken,
  type EdgeScope,
  type ResolveErrorReason,
} from "./tokens";

export const QUARANTINE_BYPASS_SCOPES: ReadonlySet<EdgeScope> = new Set([
  "edge:heartbeat",
]);

export type EdgeAuthContext = {
  tokenId: string;
  edgeNodeId: string;
  nodeId: string;
  principalId: string;
  trustState: string;
  status: string;
  scopes: EdgeScope[];
};

export type EdgeAuthFailure =
  | { ok: false; status: 401; error: "missing_bearer" | "invalid_bearer" | "invalid_format" | "not_found" | "revoked" | "expired" | "rotated_out_of_grace" | "node_not_found" | "node_revoked" }
  | { ok: false; status: 403; error: "node_quarantined" | "missing_scope" };

export type EdgeAuthResult =
  | { ok: true; context: EdgeAuthContext }
  | EdgeAuthFailure;

function extractBearer(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/.exec(header);
  if (!match) return null;
  return match[1] ?? null;
}

function failureForResolveError(reason: ResolveErrorReason): EdgeAuthFailure {
  return { ok: false, status: 401, error: reason };
}

export async function authenticateEdgeRequest(
  request: NextRequest,
  requiredScope: EdgeScope,
): Promise<EdgeAuthResult> {
  const plaintext = extractBearer(request);
  if (!plaintext) return { ok: false, status: 401, error: "missing_bearer" };

  const resolved = await resolveNodeToken(plaintext);
  if (!resolved.ok) {
    return failureForResolveError(resolved.error);
  }

  const node = await prisma.edgeNode.findUnique({
    where: { id: resolved.token.edgeNodeId },
    select: {
      id: true,
      nodeId: true,
      principalId: true,
      trustState: true,
      status: true,
    },
  });
  if (!node) return { ok: false, status: 401, error: "node_not_found" };

  if (node.trustState === "revoked") {
    return { ok: false, status: 401, error: "node_revoked" };
  }
  if (
    node.trustState === "quarantined"
    && !QUARANTINE_BYPASS_SCOPES.has(requiredScope)
  ) {
    return { ok: false, status: 403, error: "node_quarantined" };
  }

  if (!resolved.token.scopes.includes(requiredScope)) {
    return { ok: false, status: 403, error: "missing_scope" };
  }

  return {
    ok: true,
    context: {
      tokenId: resolved.token.tokenId,
      edgeNodeId: node.id,
      nodeId: node.nodeId,
      principalId: node.principalId,
      trustState: node.trustState,
      status: node.status,
      scopes: resolved.token.scopes,
    },
  };
}
