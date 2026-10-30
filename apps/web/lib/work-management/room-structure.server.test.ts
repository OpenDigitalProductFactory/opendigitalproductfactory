import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    opportunity: { findFirst: vi.fn() },
    backlogItem: { findFirst: vi.fn() },
    workroom: { findFirst: vi.fn() },
    eaReferenceModelElement: { findFirst: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => ({ prisma }));

import { resolveWorkroomStructureForCase } from "./room-structure.server";

const room = (shape: string, stageKey: string | null) => ({
  scopeClaims: [{ source: "declared", workShape: shape }],
  workspaceState: { workroomDrive: { kind: "workroom-drive", action: "dispatch_agent", reason: "agent_stage", stageKey } },
});

// BI-B8B3FB70: a delivery room sits at the IT4IT stage its work-shape stage maps to.
describe("resolveWorkroomStructureForCase for a platform delivery room", () => {
  beforeEach(() => {
    for (const model of Object.values(prisma)) model.findFirst.mockReset();
    prisma.eaReferenceModelElement.findFirst.mockResolvedValue({ name: "Build, Integrate, & Test Stage", parent: { name: "Integrate" } });
  });

  it("names the IT4IT stream and stage of a backlog item's room, found by its itemId or row id", async () => {
    prisma.backlogItem.findFirst.mockResolvedValue({ id: "row-1" });
    prisma.workroom.findFirst.mockResolvedValue(room("delivery-small@1.0.0", "repair"));
    const structure = await resolveWorkroomStructureForCase({ sourceType: "backlog-item", sourceId: "BI-1" });
    expect(prisma.workroom.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { backlogItemId: { in: ["BI-1", "row-1"] } } }));
    expect(prisma.eaReferenceModelElement.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind: "value_stream_stage", model: { slug: "it4it_v3_0_1" }, properties: { path: ["participationReference"], equals: "5.3.4" } },
    }));
    expect(structure?.valueStream).toMatchObject({ reference: "it4it-3.0.1", stream: "Integrate", participationReference: "5.3.4" });
    expect(structure?.lifecycle?.grammarKey).toBe("platform-delivery");
  });

  it("finds a work-capsule room by its capsule id", async () => {
    prisma.workroom.findFirst.mockResolvedValue(room("delivery-medium@1.0.0", "implement"));
    await resolveWorkroomStructureForCase({ sourceType: "work-capsule", sourceId: "WC-1" });
    expect(prisma.workroom.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { capsuleId: "WC-1" } }));
  });

  it("resolves nothing, never a guess, without a stage, a binding or a seeded model", async () => {
    prisma.workroom.findFirst.mockResolvedValueOnce(room("delivery-small@1.0.0", null));
    expect(await resolveWorkroomStructureForCase({ sourceType: "work-capsule", sourceId: "WC-1" })).toBeNull();
    prisma.workroom.findFirst.mockResolvedValueOnce(room("dependency-advisory-watch@1.0.0", "triage"));
    expect(await resolveWorkroomStructureForCase({ sourceType: "work-capsule", sourceId: "WC-1" })).toBeNull();
    prisma.workroom.findFirst.mockResolvedValueOnce(room("delivery-small@1.0.0", "repair"));
    prisma.eaReferenceModelElement.findFirst.mockResolvedValueOnce(null);
    expect(await resolveWorkroomStructureForCase({ sourceType: "work-capsule", sourceId: "WC-1" })).toBeNull();
    prisma.workroom.findFirst.mockResolvedValueOnce(null);
    expect(await resolveWorkroomStructureForCase({ sourceType: "work-capsule", sourceId: "WC-1" })).toBeNull();
  });
});
