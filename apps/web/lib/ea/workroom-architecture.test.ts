import { describe, expect, it, vi } from "vitest";

import { loadWorkroomArchitecture, loadWorkroomCoordination } from "./workroom-architecture";

describe("loadWorkroomArchitecture", () => {
  it("links actual rooms and reports missing architecture placement without guessing", async () => {
    const db = { workroom: { findMany: vi.fn().mockResolvedValue([
      { capsuleId: "WC-REVIEW", title: "Review change", status: "blocked", backlogItemId: "BI-ONE", workItem: { teamId: "team-1", parentItemId: "parent-1", assignedToUserId: null, assignedToAgentId: "reviewer-1" } },
      { capsuleId: "WC-UNMAPPED", title: "Unmapped work", status: "working", backlogItemId: null, workItem: null },
    ]) } };
    const projection = await loadWorkroomCoordination(db, new Date("2026-09-06T12:00:00Z"));
    expect(projection.rooms[0]).toMatchObject({ roomId: "WC-REVIEW", teamId: "team-1", status: "blocked", parentItemId: "parent-1", href: "/workspace/cases/work-capsule%3AWC-REVIEW?operation=team-1" });
    expect(projection.rooms[1]).toMatchObject({ teamId: null, assignedActorRef: null });
    expect(projection.readAt).toBe("2026-09-06T12:00:00.000Z");
    expect(projection.truncated).toBe(false);
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 201, where: { archivedAt: null, status: { notIn: ["complete", "abandoned", "archived"] } } }));
  });

  it("reports bounded projection truncation instead of presenting a total", async () => {
    const db = { workroom: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ capsuleId: `WC-${i}`, title: "Work", status: "ready", workItem: null }))) } };
    const projection = await loadWorkroomCoordination(db, new Date("2026-09-06T12:00:00Z"));
    expect(projection.rooms).toHaveLength(200);
    expect(projection.truncated).toBe(true);
  });

  it("filters by the selected operation before applying the bounded read", async () => {
    const db = { workroom: { findMany: vi.fn().mockResolvedValue([]) } };
    await loadWorkroomCoordination(db, new Date("2026-09-06T12:00:00Z"), { teamId: "team-review" });
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workItem: { is: { teamId: "team-review" } } }) }));
  });
  it("always returns four portfolio bands and projects shape, triggers, participants, queues, and instances", async () => {
    const db = { valueStreamTeam: { findMany: vi.fn().mockResolvedValue([
      {
        id: "team-1", name: "Animal intake", valueStream: "intake-and-safety", teamPattern: "specialist-dispatch",
        coordinationPattern: { portfolioRole: "manufactureAndDeliver" }, eaProcessId: "process-1", eaViewId: "view-1",
        portfolioId: "portfolio-1", portfolio: { slug: "operations", name: "Operations" }, isActive: true,
        roles: [{ roleName: "Intake coordinator", workerType: "human", requiredRole: null }],
        hitlGates: [{ triggerPoint: "on-error", requiredRole: "HR-000", escalationTimeoutMinutes: 30 }],
        queues: [{ queueId: "Q-1", name: "Intake queue", queueType: "triage", isActive: true }],
        workItems: [{ _count: { capsules: 2 } }],
      },
    ]) } };

    const result = await loadWorkroomArchitecture(db);

    expect(result.map((band) => band.role)).toEqual([
      "foundational", "manufactureAndDeliver", "forEmployees", "productsAndServicesSold",
    ]);
    expect(result[1]?.definitions[0]).toEqual(expect.objectContaining({
      name: "Animal intake",
      shape: "specialist-dispatch",
      instanceCount: 2,
      participants: [expect.objectContaining({ roleName: "Intake coordinator" })],
      triggers: [expect.objectContaining({ triggerPoint: "on-error", requiredRole: "HR-000" })],
      queues: [expect.objectContaining({ name: "Intake queue" })],
      eaViewId: "view-1",
    }));
    expect(result[0]?.definitions).toEqual([]);
  });
});
