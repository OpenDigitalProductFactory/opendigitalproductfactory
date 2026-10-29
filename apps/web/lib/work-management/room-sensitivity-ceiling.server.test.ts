import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { resolveWorkItemRoomSensitivityCeiling } from "./room-sensitivity-ceiling.server";

// BI-ED5561BB: a room reached by caseKey (a WorkItem) resolves its ceiling the
// way a Workroom does, so DI-5E19848444FC (platform work reads as public)
// applies to room messaging, invites and the charter too.
const findFirst = vi.fn();
const db = { backlogItem: { findFirst } } as never;
const backlogRoom = (evidence: unknown = []) => ({ evidence, sourceType: "backlog-item", sourceId: "BI-1" });

beforeEach(() => {
  findFirst.mockReset();
});

describe("resolveWorkItemRoomSensitivityCeiling", () => {
  it("reads a platform-scope backlog room as public", async () => {
    findFirst.mockResolvedValue({ sensitivity: "internal", scopeKind: "platform", digitalProduct: null });
    await expect(resolveWorkItemRoomSensitivityCeiling(backlogRoom(), db)).resolves.toBe("public");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ itemId: "BI-1" }, { id: "BI-1" }] } }));
  });

  it("keeps a non-platform backlog room at its stored sensitivity", async () => {
    findFirst.mockResolvedValue({ sensitivity: "internal", scopeKind: "archetype-leaf", digitalProduct: null });
    await expect(resolveWorkItemRoomSensitivityCeiling(backlogRoom(), db)).resolves.toBe("internal");
  });

  it("keeps confidential and restricted platform work where it was put", async () => {
    findFirst.mockResolvedValue({ sensitivity: "restricted", scopeKind: "platform", digitalProduct: null });
    await expect(resolveWorkItemRoomSensitivityCeiling(backlogRoom(), db)).resolves.toBe("restricted");
  });

  it("lets an explicit room-policy ceiling win over the backlog item", async () => {
    findFirst.mockResolvedValue({ sensitivity: "internal", scopeKind: "platform", digitalProduct: null });
    await expect(resolveWorkItemRoomSensitivityCeiling(backlogRoom([{ workroomPolicy: { sensitivityCeiling: "internal" } }]), db))
      .resolves.toBe("internal");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("fails closed to internal for a room with no backlog item or an unknown one", async () => {
    await expect(resolveWorkItemRoomSensitivityCeiling({ evidence: [], sourceType: "workroom", sourceId: "WC-1" }, db))
      .resolves.toBe("internal");
    await expect(resolveWorkItemRoomSensitivityCeiling({ evidence: [] }, db)).resolves.toBe("internal");
    findFirst.mockResolvedValue(null);
    await expect(resolveWorkItemRoomSensitivityCeiling(backlogRoom(), db)).resolves.toBe("internal");
  });
});
