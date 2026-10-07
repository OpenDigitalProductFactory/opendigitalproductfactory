import { describe, expect, it, vi } from "vitest";

import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";
import { ACCEPTANCE_VERIFICATION_SHAPE_REF } from "@/lib/work-management/acceptance-verification-shape";
import { buildWorkShapeClaim, buildWorkShapeRoleBindingsClaim } from "@/lib/work-management/workroom-shape-claim";

import { issueAcceptanceObjectiveMappingPacket, type IssuePacketDb } from "./issue-objective-mapping-packet";
import { ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND } from "./steward-objective-mapping-authority";

// BI-099A0BA3: the sweep issues the owner's server-minted objective-mapping
// packet to the item's steward room, once per request key.

const ITEM = "BI-AAAA0001";
const NOW = new Date("2026-10-07T05:00:00.000Z");

function packet(over: { targetAgent?: string; requestKey?: string; itemId?: string } = {}) {
  const binding = {
    writerToolName: "record_initiative_evidence",
    itemId: over.itemId ?? ITEM,
    gate: "objective-mapping" as const,
    expectedCurrentBaselineId: "baseline-1",
    eligibleEvidenceActivityIds: ["E-1"],
    workroomRef: { kind: "workroom-head" as const, workroomId: "WC-DELIVERY", repositoryFullName: "o/r", branchName: "fix/x", headSha: "a".repeat(40) },
    artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "o/r", commitSha: "b".repeat(40), path: "docs/d.md", providerBlobId: "c".repeat(40) },
  };
  const base = {
    targetAgent: over.targetAgent ?? "AGT-WS-VERIFY",
    objective: "Map every objective.",
    questionPacketSummary: `Objective mapping for ${ITEM}`,
    requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
    binding,
  };
  return {
    targetAgent: base.targetAgent,
    objective: base.objective,
    questionPacketSummary: base.questionPacketSummary,
    requestKey: over.requestKey ?? createObjectiveMappingRequestKey(base),
    tier: 2 as const,
    enteredVia: "handoff" as const,
    requiredToolNames: base.requiredToolNames,
    initiativeReviewBinding: binding,
  };
}

function liveRoom(over: Record<string, unknown> = {}, verifier = "AGT-WS-VERIFY") {
  return {
    id: "room-1", capsuleId: "WC-ACC-AAAA0001", source: "scheduled-steward", archivedAt: null, status: "working",
    scopeClaims: [
      buildWorkShapeClaim(ACCEPTANCE_VERIFICATION_SHAPE_REF, NOW),
      buildWorkShapeRoleBindingsClaim({ "acceptance-verifier": `agent:${verifier}` }, NOW),
    ],
    ...over,
  };
}

function fakeDb(input: { room?: Record<string, unknown> | null; latest?: { payload: unknown; recordedByAgentId: string | null } | null } = {}) {
  const db = {
    workroom: {
      findUnique: vi.fn(async () => (input.room === undefined ? liveRoom() : input.room)),
      update: vi.fn(async () => ({ id: "room-1" })),
    },
    workroomActivity: {
      findFirst: vi.fn(async () => input.latest ?? null),
      create: vi.fn(async () => ({ id: "act-1" })),
    },
  };
  return { db: db as unknown as IssuePacketDb, raw: db };
}

const issue = (db: IssuePacketDb, over: Partial<Parameters<typeof issueAcceptanceObjectiveMappingPacket>[0]> = {}) =>
  issueAcceptanceObjectiveMappingPacket({ db, itemId: ITEM, ownerAgentId: "AGT-WS-VERIFY", packet: packet(), objective: "brief with packet", now: NOW, ...over });

describe("issueAcceptanceObjectiveMappingPacket (BI-099A0BA3)", () => {
  it("appends the packet to the steward room as the sweep, and refreshes the room brief", async () => {
    const { db, raw } = fakeDb();

    await expect(issue(db)).resolves.toBe("issued");

    expect(raw.workroom.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: `acceptance:${ITEM}` } }));
    expect(raw.workroomActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workCapsuleId: "room-1",
        kind: ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND,
        recordedByAgentId: "AGT-WS-PORTFOLIO",
        payload: expect.objectContaining({ schemaVersion: 1, itemId: ITEM, requestCoworker: packet() }),
      }),
      select: { id: true },
    });
    expect(raw.workroom.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "room-1" }, data: expect.objectContaining({ objective: "brief with packet" }) }));
  });

  it("is idempotent by request key: the same packet is not issued twice", async () => {
    const { db, raw } = fakeDb({ latest: { payload: { requestCoworker: packet() }, recordedByAgentId: "AGT-WS-PORTFOLIO" } });

    await expect(issue(db)).resolves.toBe("current");
    expect(raw.workroomActivity.create).not.toHaveBeenCalled();
    expect(raw.workroom.update).not.toHaveBeenCalled();
  });

  it("issues a successor packet when the request key changed", async () => {
    const stale = packet();
    const { db, raw } = fakeDb({ latest: { payload: { requestCoworker: { ...stale, requestKey: "older-key" } }, recordedByAgentId: "AGT-WS-PORTFOLIO" } });

    await expect(issue(db)).resolves.toBe("issued");
    expect(raw.workroomActivity.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a packet whose key the server did not derive", { packet: packet({ requestKey: "forged" }) }],
    ["a packet for another coworker than the owner", { ownerAgentId: "AGT-OTHER" }],
    ["a packet for another item", { packet: packet({ itemId: "BI-OTHER" }) }],
  ])("issues nothing for %s", async (_label, over) => {
    const { db, raw } = fakeDb();
    await expect(issue(db, over as never)).resolves.toBe("not-issuable");
    expect(raw.workroomActivity.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no room", null],
    ["an archived room", liveRoom({ archivedAt: NOW })],
    ["a finished room", liveRoom({ status: "complete" })],
  ])("issues nothing to %s", async (_label, room) => {
    const { db, raw } = fakeDb({ room });
    await expect(issue(db)).resolves.toBe("no-live-room");
    expect(raw.workroomActivity.create).not.toHaveBeenCalled();
  });
});

describe("issueAcceptanceObjectiveMappingPacket: the room's bound verifier (BI-099A0BA3)", () => {
  it("issues nothing when the room's verify stage is bound to another coworker than the owner", async () => {
    const { db, raw } = fakeDb({ room: liveRoom({}, "AGT-EARLIER-OWNER") });
    await expect(issue(db)).resolves.toBe("not-issuable");
    expect(raw.workroomActivity.create).not.toHaveBeenCalled();
  });
});

describe("issueAcceptanceObjectiveMappingPacket: review findings (BI-099A0BA3)", () => {
  const sweepPacket = (targetAgent: string) => ({ payload: { requestCoworker: packet(targetAgent === "AGT-WS-VERIFY" ? {} : { targetAgent }) }, recordedByAgentId: "AGT-WS-PORTFOLIO" });

  it("M1: withdraws the room's packet when its coworker turns out to have delivered the item, so it is no longer the newest", async () => {
    const { db, raw } = fakeDb({ latest: sweepPacket("AGT-WS-VERIFY") });

    await expect(issue(db, { packet: undefined, ownerAgentId: null, excludedAgentIds: ["AGT-WS-VERIFY"] })).resolves.toBe("withdrawn");

    expect(raw.workroomActivity.create).toHaveBeenCalledTimes(1);
    expect(raw.workroomActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: ACCEPTANCE_OBJECTIVE_MAPPING_PACKET_KIND,
        recordedByAgentId: "AGT-WS-PORTFOLIO",
        payload: expect.objectContaining({ withdrawn: true, withdrawnTargetAgent: "AGT-WS-VERIFY", withdrawnRequestKey: packet().requestKey }),
      }),
      select: { id: true },
    });
  });

  it("M1: never issues a packet to a delivery actor", async () => {
    const { db, raw } = fakeDb();
    await expect(issue(db, { excludedAgentIds: ["AGT-WS-VERIFY"] })).resolves.toBe("not-issuable");
    expect(raw.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("does nothing for a room with no packet owed and none to withdraw", async () => {
    const { db, raw } = fakeDb();
    await expect(issue(db, { packet: undefined, ownerAgentId: null, excludedAgentIds: ["AGT-OTHER"] })).resolves.toBeNull();
    expect(raw.workroomActivity.create).not.toHaveBeenCalled();
  });

  it.each([
    ["another capsule id under the steward key", { capsuleId: "WC-SOMETHING-ELSE" }],
    ["a room the sweep did not create", { source: "external-claim" }],
  ])("Info: treats %s as no steward room", async (_label, over) => {
    const { db, raw } = fakeDb({ room: liveRoom(over) });
    await expect(issue(db)).resolves.toBe("no-live-room");
    expect(raw.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("L2: a room still pinned to the 1.0.0 shape (no objective-mapping write) is reported shape-outdated, not issued", async () => {
    const { db, raw } = fakeDb({ room: liveRoom({ scopeClaims: [
      buildWorkShapeClaim("acceptance-verification@1.0.0", NOW),
      buildWorkShapeRoleBindingsClaim({ "acceptance-verifier": "agent:AGT-WS-VERIFY" }, NOW),
    ] }) });
    await expect(issue(db)).resolves.toBe("shape-outdated");
    expect(raw.workroomActivity.create).not.toHaveBeenCalled();
  });
});
