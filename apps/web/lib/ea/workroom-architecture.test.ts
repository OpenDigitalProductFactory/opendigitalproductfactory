import { describe, expect, it, vi } from "vitest";

import { loadWorkroomArchitecture, loadWorkroomCoordination, resolvePortfolioPlacement } from "./workroom-architecture";

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

    expect(result.bands.map((band) => band.role)).toEqual([
      "foundational", "manufactureAndDeliver", "forEmployees", "productsAndServicesSold",
    ]);
    expect(result.bands[1]?.definitions[0]).toEqual(expect.objectContaining({
      name: "Animal intake",
      shape: "specialist-dispatch",
      instanceCount: 2,
      participants: [expect.objectContaining({ roleName: "Intake coordinator" })],
      triggers: [expect.objectContaining({ triggerPoint: "on-error", requiredRole: "HR-000" })],
      queues: [expect.objectContaining({ name: "Intake queue" })],
      eaViewId: "view-1",
    }));
    expect(result.bands[0]?.definitions).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });
});

describe("resolvePortfolioPlacement", () => {
  it("prefers the recorded decision and names it as the deciding source", () => {
    expect(resolvePortfolioPlacement({
      coordinationPattern: { portfolioRole: "forEmployees" },
      portfolio: { slug: "operations", name: "Operations" },
    })).toEqual({ role: "forEmployees", source: "coordination-pattern" });
  });

  it("falls back to slug then name, reporting the weaker derivation honestly", () => {
    expect(resolvePortfolioPlacement({ portfolio: { slug: "operations", name: "Anything" } }))
      .toEqual({ role: "manufactureAndDeliver", source: "portfolio-slug" });
    expect(resolvePortfolioPlacement({ portfolio: { slug: "nonsense", name: "Workforce" } }))
      .toEqual({ role: "forEmployees", source: "portfolio-name" });
  });

  it("reports an unrecognised portfolio as unresolved rather than defaulting to Foundational", () => {
    const placement = resolvePortfolioPlacement({ portfolio: { slug: "mystery-stream", name: "Mystery" } });
    expect(placement.role).toBeNull();
    expect(placement.source).toBe("unresolved");
    expect(placement).toHaveProperty("reason", expect.stringContaining("mystery-stream"));
  });

  it("reports a team with no portfolio link as unresolved", () => {
    const placement = resolvePortfolioPlacement({ portfolio: null });
    expect(placement.role).toBeNull();
    expect(placement).toHaveProperty("reason", "The team is linked to no portfolio.");
  });
});

describe("loadWorkroomArchitecture placement truthfulness", () => {
  it("keeps unresolved teams out of the four portfolios and in a separate exception group", async () => {
    const db = { valueStreamTeam: { findMany: vi.fn().mockResolvedValue([
      TEAM_PLACED,
      TEAM_UNRESOLVED,
    ]) } };
    const projection = await loadWorkroomArchitecture(db);
    expect(projection.bands).toHaveLength(4);
    const foundational = projection.bands.find((band) => band.role === "foundational")!;
    expect(foundational.definitions).toHaveLength(0);
    expect(projection.bands.find((band) => band.role === "manufactureAndDeliver")!.definitions.map((d) => d.id)).toEqual(["team-1"]);
    expect(projection.unplaced.map((d) => d.id)).toEqual(["team-2"]);
    const total = projection.bands.reduce((n, band) => n + band.definitions.length, 0) + projection.unplaced.length;
    expect(total).toBe(2);
  });

  it("carries placement provenance onto each definition", async () => {
    const db = { valueStreamTeam: { findMany: vi.fn().mockResolvedValue([TEAM_PLACED]) } };
    const projection = await loadWorkroomArchitecture(db);
    expect(projection.bands.find((band) => band.role === "manufactureAndDeliver")!.definitions[0]!.placement)
      .toEqual({ role: "manufactureAndDeliver", source: "coordination-pattern" });
  });

  it("labels a truncated read as partial instead of presenting it as complete", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ ...TEAM_PLACED, id: `team-${i}` }));
    const db = { valueStreamTeam: { findMany: vi.fn().mockResolvedValue(many) } };
    const projection = await loadWorkroomArchitecture(db);
    expect(projection.truncated).toBe(true);
    expect(projection.observed).toBe(200);
    expect(db.valueStreamTeam.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 201 }));
  });

  it("reports a complete read as not truncated", async () => {
    const db = { valueStreamTeam: { findMany: vi.fn().mockResolvedValue([TEAM_PLACED]) } };
    const projection = await loadWorkroomArchitecture(db);
    expect(projection.truncated).toBe(false);
    expect(projection.observed).toBe(1);
  });
});

const TEAM_PLACED = {
        id: "team-1", name: "Team 1", valueStream: "vs", teamPattern: "specialist-dispatch",
        coordinationPattern: { portfolioRole: "manufactureAndDeliver" }, eaProcessId: null, eaViewId: null,
        portfolioId: "p", portfolio: { slug: "operations", name: "Operations" }, isActive: true,
        roles: [], hitlGates: [], queues: [], workItems: [{ _count: { capsules: 1 } }],
      };

const TEAM_UNRESOLVED = {
        id: "team-2", name: "Team 2", valueStream: "vs", teamPattern: "specialist-dispatch",
        coordinationPattern: {}, eaProcessId: null, eaViewId: null,
        portfolioId: "p", portfolio: { slug: "mystery-stream", name: "Mystery" }, isActive: true,
        roles: [], hitlGates: [], queues: [], workItems: [{ _count: { capsules: 1 } }],
      };
