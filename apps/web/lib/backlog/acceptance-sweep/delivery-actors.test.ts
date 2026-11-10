import { describe, expect, it, vi } from "vitest";

import { deliveryActorIdsFrom, loadItemDeliveryActorIds, MAX_DELIVERY_ROOMS, type DeliveryActorDb } from "./delivery-actors";

// BI-099A0BA3 (security review M1): every agent that delivered an item is
// excluded from verifying it, not only the newest room's assistant.

const agent = (id: string) => ({ kind: "agent", aliases: [{ aliasValue: id }] });
const human = (id: string) => ({ kind: "human", aliases: [{ aliasValue: id }] });

function room(over: Record<string, unknown> = {}) {
  return { capsuleId: "WC-1", executorKind: null, createdByPrincipal: null, leaseHolderPrincipal: null, participants: [], ...over };
}

describe("deliveryActorIdsFrom", () => {
  it("collects creators, lease holders and working participants of every room, plus the claimant and the item's agent", () => {
    const ids = deliveryActorIdsFrom({
      itemId: "BI-AAAA0001",
      claimedByAgentId: "AGT-CLAIM",
      agentId: "AGT-ITEM",
      buildStudioAgentId: null,
      rooms: [
        // R1: where A delivered, long ago, now archived and A's participation retired.
        room({ capsuleId: "WC-R1", createdByPrincipal: agent("AGT-A"), participants: [{ roles: ["contributor"], principal: agent("AGT-A2") }] }),
        // R2: newer room touched by B.
        room({ capsuleId: "WC-R2", leaseHolderPrincipal: agent("AGT-B"), participants: [{ roles: ["specialist"], principal: agent("AGT-C") }] }),
      ],
    });
    expect(ids).toEqual(["AGT-A", "AGT-A2", "AGT-B", "AGT-C", "AGT-CLAIM", "AGT-ITEM"]);
  });

  it("leaves out people, reviewing-only participants, and the item's own steward room", () => {
    const ids = deliveryActorIdsFrom({
      itemId: "BI-AAAA0001",
      claimedByAgentId: null,
      agentId: null,
      buildStudioAgentId: null,
      rooms: [
        room({ createdByPrincipal: human("user-1"), participants: [
          { roles: ["reviewer"], principal: agent("AGT-REVIEW") },
          { roles: ["observer", "approver"], principal: agent("AGT-WATCH") },
          { roles: ["reviewer", "contributor"], principal: agent("AGT-BOTH") },
        ] }),
        room({ capsuleId: "WC-ACC-AAAA0001", createdByPrincipal: agent("AGT-VERIFIER"), participants: [{ roles: ["contributor"], principal: agent("AGT-VERIFIER") }] }),
      ],
    });
    expect(ids).toEqual(["AGT-BOTH"]);
  });

  it("names the Build Studio assistant for a Build Studio room", () => {
    expect(deliveryActorIdsFrom({
      itemId: "BI-X", claimedByAgentId: null, agentId: null, buildStudioAgentId: "AGT-WS-BUILD",
      rooms: [room({ executorKind: "build-studio" })],
    })).toEqual(["AGT-WS-BUILD"]);
  });
});

describe("loadItemDeliveryActorIds", () => {
  const item = { id: "row-1", itemId: "BI-AAAA0001", claimedByAgentId: null, agentId: "AGT-ITEM" };

  it("reads rooms bound by either the BI- id or the row id, live or archived", async () => {
    const findMany = vi.fn(async () => [room({ createdByPrincipal: agent("AGT-A") })]);
    const db = { backlogItem: { findUnique: vi.fn(async () => item) }, workroom: { findMany } } as unknown as DeliveryActorDb;

    await expect(loadItemDeliveryActorIds(db, "BI-AAAA0001")).resolves.toEqual({ ok: true, data: ["AGT-A", "AGT-ITEM"] });
    const query = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0];
    expect(query.where).toEqual({ backlogItemId: { in: ["BI-AAAA0001", "row-1"] } });
  });

  it("fails closed for an unknown item or more rooms than the bound", async () => {
    const missing = { backlogItem: { findUnique: vi.fn(async () => null) }, workroom: { findMany: vi.fn() } } as unknown as DeliveryActorDb;
    await expect(loadItemDeliveryActorIds(missing, "BI-NONE")).resolves.toMatchObject({ ok: false });

    const many = Array.from({ length: MAX_DELIVERY_ROOMS + 1 }, (_, index) => room({ capsuleId: `WC-${index}` }));
    const db = { backlogItem: { findUnique: vi.fn(async () => item) }, workroom: { findMany: vi.fn(async () => many) } } as unknown as DeliveryActorDb;
    await expect(loadItemDeliveryActorIds(db, "BI-AAAA0001")).resolves.toMatchObject({ ok: false });
  });
});
