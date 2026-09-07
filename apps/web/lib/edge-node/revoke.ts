// Single home for "retire this Edge Node" (AGENTS §8: compose from shared
// primitives, never a second copy per caller). The admin server action, the
// stale-enrollment janitor and enrollment-time supersession all revoke through
// here, so the invariant — trust revoked, node token cleared, every live
// certificate revoked, in one transaction — has exactly one implementation.

export interface RevokeEdgeNodeDb {
  edgeNode: {
    findUnique(args: unknown): Promise<{ id: string; trustState: string } | null>;
    update(args: unknown): Promise<unknown>;
  };
  edgeNodeCertificate: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  $transaction<T>(operations: Promise<T>[]): Promise<T[]>;
}

export type RevokeEdgeNodeResult =
  | { status: "revoked"; edgeNodeId: string; changed: boolean }
  | { status: "not_found" | "invalid_input"; message: string };

export async function revokeEdgeNode(
  db: RevokeEdgeNodeDb,
  input: { edgeNodeId: string; reason: string; now?: Date },
): Promise<RevokeEdgeNodeResult> {
  const reason = input.reason?.trim();
  if (!input.edgeNodeId || typeof input.edgeNodeId !== "string") {
    return { status: "invalid_input", message: "edgeNodeId required" };
  }
  if (!reason) {
    return { status: "invalid_input", message: "revocation reason required" };
  }
  const node = await db.edgeNode.findUnique({
    where: { id: input.edgeNodeId },
    select: { id: true, trustState: true },
  });
  if (!node) return { status: "not_found", message: "Edge Node not found" };
  // Revoking an already-revoked node is idempotent (no-op).
  if (node.trustState === "revoked") {
    return { status: "revoked", edgeNodeId: node.id, changed: false };
  }

  // Revoke the node + null its tokenHash so any further request bearing the
  // now-orphaned token fails at auth resolution (the hash on the row IS the
  // credential). Re-enrollment is operator-explicit per spec § Re-enrollment.
  const revokedAt = input.now ?? new Date();
  await db.$transaction([
    db.edgeNode.update({
      where: { id: node.id },
      data: {
        trustState: "revoked",
        revokedAt,
        revocationReason: reason,
        tokenHash: null,
        tokenPrefix: null,
        tokenRotatedAt: null,
      },
    }),
    db.edgeNodeCertificate.updateMany({
      where: { edgeNodeId: node.id, status: { not: "revoked" } },
      data: {
        status: "revoked",
        revokedAt,
        revocationReason: `node_revoked:${reason}`,
      },
    }),
  ]);
  return { status: "revoked", edgeNodeId: node.id, changed: true };
}
