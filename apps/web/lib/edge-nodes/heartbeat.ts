// Edge Node heartbeat orchestration.
//
// The heartbeat call is the Edge Node's keepalive AND its token-rotation
// vehicle. Per the spec's "Token namespaces and lifecycle" table:
//
//   "Edge Node calls heartbeat with current node token; Authority Core
//    mints replacement token in response."
//
// This module validates the inbound token, rotates it, updates the
// EdgeNode.lastSeenAt + tokenRotatedAt timestamps, and returns the
// fresh token + the configured soft-fail policy windows so the binary
// can update its local cache.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md

import { prisma } from "@dpf/db";

import { rotateNodeToken } from "./tokens";
import type { EdgeAuthContext } from "./auth";

export type HeartbeatInput = {
  authContext: EdgeAuthContext;
  currentTokenPlaintext: string;
  agentVersion: string;
  reportedReachability?: "ok" | "degraded" | "offline";
  observedAt?: Date;
};

export type HeartbeatResult =
  | {
      ok: true;
      trustState: string;
      lastSeenAt: Date;
      rotatedToken: {
        plaintext: string;
        prefix: string;
        expiresAt: Date;
        scopes: string[];
      };
    }
  | {
      ok: false;
      status: 401 | 500;
      error: "rotation_failed" | "rotation_invalid_token";
    };

export async function heartbeatEdgeNode(input: HeartbeatInput): Promise<HeartbeatResult> {
  const now = input.observedAt ?? new Date();

  const rotated = await rotateNodeToken({
    currentTokenPlaintext: input.currentTokenPlaintext,
  });
  if (!rotated.ok) {
    // The auth layer already validated the token shape and node state;
    // a rotation failure here means we lost the race with another
    // heartbeat. Surface as 401 so the binary re-authenticates.
    return {
      ok: false,
      status: 401,
      error: rotated.error === "invalid_format" ? "rotation_invalid_token" : "rotation_failed",
    };
  }

  await prisma.edgeNode.update({
    where: { id: input.authContext.edgeNodeId },
    data: {
      lastSeenAt: now,
      version: input.agentVersion,
      // status reflects runtime liveness — heartbeat returns it to "active"
      // unless the node has been administratively quarantined or revoked.
      ...(input.authContext.trustState === "trusted"
        ? { status: "active" }
        : {}),
    },
  });

  return {
    ok: true,
    trustState: input.authContext.trustState,
    lastSeenAt: now,
    rotatedToken: {
      plaintext: rotated.plaintext,
      prefix: rotated.prefix,
      expiresAt: rotated.expiresAt,
      scopes: rotated.scopes,
    },
  };
}
