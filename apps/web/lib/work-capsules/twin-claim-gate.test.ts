import { describe, expect, it, vi } from "vitest";

import { evaluateTwinClaimGate, type TwinGateDb } from "./twin-claim-gate";

const PEER = "inst_0123456789abcdef0123456789abcdef";
const MARKER = "[origin:tool-defect:surface_open]";
const localItem = { id: "row-local", itemId: "BI-LOCAL", status: "open", body: `x\n\n${MARKER}` };
const peerMirror = { id: "row-peer", itemId: "BI-PEER", status: "open", body: `x\n\n${MARKER}\n[origin:federatedWork:${PEER}:BI-PEER]` };

function gateDb(item: typeof localItem, rows: Array<typeof localItem>, claims: Record<string, unknown> = {}, reclaim = 0): TwinGateDb {
  return {
    backlogItem: { findFirst: vi.fn().mockResolvedValue(item), findMany: vi.fn().mockResolvedValue(rows) },
    federatedRecordMirror: {
      findMany: vi.fn(async () => Object.entries(claims).map(([localRecordRef, claim]) => ({ localRecordRef, payload: { claim } }))),
    },
    workroom: { count: vi.fn().mockResolvedValue(reclaim) },
  };
}

const input = { itemId: "BI-LOCAL", headBranch: "fix/x", force: false, overrideReason: null };

describe("evaluateTwinClaimGate (AC-4)", () => {
  it("refuses a local item whose peer twin is claimed, naming the twin", async () => {
    const db = gateDb(localItem, [localItem, peerMirror], { "BI-PEER": { active: true, since: null, workrooms: 1 } });
    const outcome = await evaluateTwinClaimGate(db, input);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.result.error).toBe("federated_twin_in_progress");
    expect(outcome.result.message).toContain("BI-PEER");
    expect((outcome.result.data as { twins: Array<{ reason: string }> }).twins).toEqual([
      expect.objectContaining({ itemId: "BI-PEER", reason: "peer-twin-in-progress" }),
    ]);
  });

  it("clears when the peer twin is open but nobody is on it", async () => {
    const db = gateDb(localItem, [localItem, peerMirror], { "BI-PEER": { active: false, since: null, workrooms: 0 } });
    expect(await evaluateTwinClaimGate(db, input)).toEqual({ kind: "clear" });
  });

  it("refuses claiming the peer's own mirror unless forced with a reason", async () => {
    const db = gateDb(peerMirror, [peerMirror]);
    const refused = await evaluateTwinClaimGate(db, { ...input, itemId: "BI-PEER" });
    expect(refused.kind).toBe("refused");
    const forced = await evaluateTwinClaimGate(db, { ...input, itemId: "BI-PEER", force: true, overrideReason: "peer asked us to take it" });
    expect(forced).toMatchObject({ kind: "overridden", reason: "peer asked us to take it", blockers: [{ itemId: "BI-PEER", reason: "peer-mirror" }] });
  });

  it("does not re-gate a re-claim of a room this branch already holds", async () => {
    const db = gateDb(peerMirror, [peerMirror], {}, 1);
    expect(await evaluateTwinClaimGate(db, { ...input, itemId: "BI-PEER" })).toEqual({ kind: "clear" });
    expect(db.workroom.count).toHaveBeenCalledWith({
      where: { backlogItemId: { in: ["BI-PEER", "row-peer"] }, headBranch: "fix/x", status: { notIn: ["complete", "abandoned", "archived"] } },
    });
  });

  it("refuses without a reason even when force is set", async () => {
    const db = gateDb(peerMirror, [peerMirror]);
    expect((await evaluateTwinClaimGate(db, { ...input, itemId: "BI-PEER", force: true })).kind).toBe("refused");
  });
});
