import { describe, expect, it, vi } from "vitest";

import { revokeEdgeNode, type RevokeEdgeNodeDb } from "./revoke";

function db(node: { id: string; trustState: string } | null) {
  const update = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const $transaction = vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  return {
    store: {
      edgeNode: { findUnique: vi.fn().mockResolvedValue(node), update },
      edgeNodeCertificate: { updateMany },
      $transaction,
    } as unknown as RevokeEdgeNodeDb,
    update, updateMany, $transaction,
  };
}

describe("revokeEdgeNode", () => {
  it("rejects a missing id or an empty reason before touching the database", async () => {
    const { store, update } = db({ id: "row_1", trustState: "trusted" });
    expect(await revokeEdgeNode(store, { edgeNodeId: "", reason: "x" })).toMatchObject({ status: "invalid_input" });
    expect(await revokeEdgeNode(store, { edgeNodeId: "row_1", reason: "   " })).toMatchObject({ status: "invalid_input" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports not_found for an unknown node", async () => {
    const { store } = db(null);
    expect(await revokeEdgeNode(store, { edgeNodeId: "row_x", reason: "gone" })).toMatchObject({ status: "not_found" });
  });

  it("is idempotent on an already-revoked node", async () => {
    const { store, $transaction } = db({ id: "row_1", trustState: "revoked" });
    expect(await revokeEdgeNode(store, { edgeNodeId: "row_1", reason: "again" })).toEqual({ status: "revoked", edgeNodeId: "row_1", changed: false });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("revokes trust, clears the node token and revokes live certificates in one transaction", async () => {
    const now = new Date("2026-09-06T12:00:00.000Z");
    const { store, update, updateMany, $transaction } = db({ id: "row_1", trustState: "trusted" });
    const result = await revokeEdgeNode(store, { edgeNodeId: "row_1", reason: " compromised ", now });
    expect(result).toEqual({ status: "revoked", edgeNodeId: "row_1", changed: true });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "row_1" },
      data: { trustState: "revoked", revokedAt: now, revocationReason: "compromised", tokenHash: null, tokenPrefix: null, tokenRotatedAt: null },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { edgeNodeId: "row_1", status: { not: "revoked" } },
      data: { status: "revoked", revokedAt: now, revocationReason: "node_revoked:compromised" },
    });
  });
});
