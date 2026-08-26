import { describe, expect, it, vi } from "vitest";

import { loadWorkroomArchitecture } from "./workroom-architecture";

describe("loadWorkroomArchitecture", () => {
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
