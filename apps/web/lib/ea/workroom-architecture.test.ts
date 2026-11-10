import { describe, expect, it, vi } from "vitest";

import { loadRoomInventory, loadWorkroomArchitecture, loadWorkroomCoordination, loadWorkroomInitiatives, resolvePortfolioPlacement } from "./workroom-architecture";

describe("initiative operation identities", () => {
  it("searches initiative names before membership paging and resolves both aliases", async () => {
    const db = { epic: { findMany: vi.fn().mockResolvedValue([{ id: "late-row", epicId: "EP-LATE", title: "Rescue intake", description: null, scopeKind: "business" }]) },
      workroom: { groupBy: vi.fn().mockResolvedValue([{ epicId: "late-row", _count: { _all: 2 } }]) } };
    const result = await loadWorkroomInitiatives(db, new Date(), " Rescue ");
    expect(db.epic.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { title: { contains: "Rescue", mode: "insensitive" } }, { epicId: { contains: "Rescue", mode: "insensitive" } },
    ] }, take: 201 }));
    expect(db.workroom.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ epicId: { in: ["EP-LATE", "late-row"] } }) }));
    expect(result.initiatives[0]).toMatchObject({ id: "EP-LATE", openRooms: 2 });
  });
  it("joins semantic and row references without counting an initiative twice", async () => {
    const db = { workroom: { groupBy: vi.fn().mockResolvedValue([
      { epicId: "epic-row", _count: { _all: 2 } }, { epicId: "EP-ONE", _count: { _all: 3 } },
      { epicId: "missing", _count: { _all: 1 } },
    ]) }, epic: { findMany: vi.fn().mockResolvedValue([
      { id: "epic-row", epicId: "EP-ONE", title: "Reliable delivery", description: "Work continues without a connected client", scopeKind: "platform" },
    ]) } };
    const result = await loadWorkroomInitiatives(db, new Date("2026-09-22T00:00:00Z"));
    expect(result.initiatives).toEqual([expect.objectContaining({ id: "EP-ONE", title: "Reliable delivery", openRooms: 5,
      storedRefs: ["EP-ONE", "epic-row"], operation: "initiative:EP-ONE" })]);
    expect(result.unresolvedRooms).toBe(1);
    expect(result.truncated).toBe(false);
    expect(db.workroom.groupBy).toHaveBeenCalledWith(expect.objectContaining({ take: 201,
      where: expect.objectContaining({ archivedAt: null, epicId: { not: null } }) }));
  });

  it("reports failed identity reads as unknown, not an empty healthy portfolio", async () => {
    const db = { workroom: { groupBy: vi.fn().mockRejectedValue(new Error("unavailable")) }, epic: { findMany: vi.fn() } };
    expect(await loadWorkroomInitiatives(db)).toMatchObject({ initiatives: [], partial: true, unresolvedRooms: null });
  });

  it("reports the membership page bound and never guesses ambiguous identity", async () => {
    const db = { workroom: { groupBy: vi.fn().mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ epicId: `ref-${i}`, _count: { _all: 1 } }))) },
      epic: { findMany: vi.fn().mockResolvedValue([
        { id: "ref-0", epicId: "EP-FIRST", title: "First", description: null, scopeKind: null },
        { id: "other", epicId: "ref-0", title: "Ambiguous", description: null, scopeKind: null },
      ]) } };
    expect(await loadWorkroomInitiatives(db)).toMatchObject({ initiatives: [], truncated: true, unresolvedRooms: 200 });
    expect(db.epic.findMany.mock.calls[0][0].where.OR[0].id.in).toHaveLength(200);
  });

  it("filters initiative aliases before paging and preserves the canonical operation link", async () => {
    const db = { workroom: { findMany: vi.fn().mockResolvedValue([
      { id: "r1", capsuleId: "WC-ONE", title: "Recovery", status: "ready", workItem: null },
    ]) } };
    const result = await loadWorkroomCoordination(db, new Date(), { initiative: { id: "EP-ONE", storedRefs: ["EP-ONE", "epic-row"] }, query: "Recovery", initiativeQuery: "Reliable" });
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ epicId: { in: ["EP-ONE", "epic-row"] } }), take: 201 }));
    expect(new URL(result.rooms[0].href, "http://localhost").searchParams.get("operation")).toBe("initiative:EP-ONE");
    expect(new URL(result.rooms[0].href, "http://localhost").searchParams.get("initiativeQuery")).toBe("Reliable");
  });
});

describe("loadWorkroomArchitecture", () => {
  it("reports failed ownership and relation reads as unknown context", async () => {
    const database = { workroom: { findMany: vi.fn().mockResolvedValue([{ id: "r1", capsuleId: "WC-ONE", title: "One", status: "ready", workItem: null }]) },
      workroomRelation: { findMany: vi.fn().mockRejectedValue(new Error("unavailable")) },
      workroomParticipant: { findMany: vi.fn() }, organization: { findFirst: vi.fn() } };
    const view = await loadWorkroomCoordination(database);
    expect(view.contextPartial).toBe(true);
    expect(view.rooms[0]).toMatchObject({ accountability: null, accountableName: null, relationships: [] });
  });
  it("shows recorded owners and dependency direction without inferring a wait", async () => {
    const database = {
      workroom: { findMany: vi.fn().mockResolvedValue([{ id: "r1", capsuleId: "WC-ONE", title: "One", status: "ready", workItem: null }]) },
      workroomRelation: { findMany: vi.fn(async (args: any) => args.where.OR ? [{
        id: "edge-1", fromWorkroomId: "r1", toWorkroomId: "r2", relation: "depends_on",
        fromWorkroom: { capsuleId: "WC-ONE", title: "One" }, toWorkroom: { capsuleId: "WC-TWO", title: "Two" },
      }] : []) },
      workroomParticipant: { findMany: vi.fn().mockResolvedValue([{ workroomId: "r1", principalId: "p1", roles: ["accountable"], principal: { displayName: "Alex" } }]) },
      organization: { findFirst: vi.fn().mockResolvedValue({ topAccountablePrincipalId: null }) },
    };
    const view = await loadWorkroomCoordination(database, new Date(), { query: "One", status: "ready" });
    expect(view.rooms[0]).toMatchObject({ accountableName: "Alex", accountability: { state: "resolved", source: "explicit-room" }, waitReason: null,
      relationships: [{ relation: "depends-on", direction: "outgoing", roomId: "WC-TWO", title: "Two" }] });
    expect(view.rooms[0].relationships[0].href).toContain("coordinationQuery=One");
    expect(view.contextPartial).toBe(false);
    expect(database.workroomRelation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1001 }));
  });
  it("combines unmapped operation, search and cursor before the page bound", async () => {
    const db = { workroom: { findMany: vi.fn().mockResolvedValue([]) } };
    await loadWorkroomCoordination(db, new Date("2026-09-21T06:00:00Z"), {
      teamId: null, query: "  recovery  ", status: "blocked", after: "WC-099",
    });
    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 201, orderBy: { capsuleId: "asc" },
      where: expect.objectContaining({
        status: "blocked", capsuleId: { gt: "WC-099" },
        AND: expect.arrayContaining([
          { OR: [{ workItem: { is: null } }, { workItem: { is: { teamId: null } } }] },
          { OR: [{ title: { contains: "recovery", mode: "insensitive" } }, { capsuleId: { contains: "recovery", mode: "insensitive" } }] },
        ]),
      }),
    }));
  });

  it("retains discovery context in a room link and uses the last displayed identity for the next page", async () => {
    const db = { workroom: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({
      capsuleId: `WC-${String(i).padStart(3, "0")}`, title: "Recovery", status: "blocked", workItem: null,
      workspaceState: { workroomDrive: { action: "attention", stageKey: "review", pendingAttention: { stageKey: "review", principalRef: "role:reviewer" } } },
    }))) } };
    const projection = await loadWorkroomCoordination(db, new Date(), { query: "Recovery", status: "blocked", after: "WC-000" });
    expect(projection.nextCursor).toBe("WC-199");
    const params = new URL(projection.rooms[0].href, "http://localhost").searchParams;
    expect(params.get("coordinationQuery")).toBe("Recovery");
    expect(params.get("coordinationStatus")).toBe("blocked");
    expect(params.get("coordinationAfter")).toBe("WC-000");
    expect(projection.rooms[0].waitReason).toBe("Stage review is waiting on role:reviewer.");
  });

  it("ignores unknown or terminal status filters rather than exposing closed rooms", async () => {
    const db = { workroom: { findMany: vi.fn().mockResolvedValue([]) } };
    for (const status of ["invented", "complete"]) {
      await loadWorkroomCoordination(db, new Date(), { status });
      expect(db.workroom.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: { notIn: ["complete", "abandoned", "archived"] } }),
      }));
    }
  });
  it("links actual rooms and reports missing architecture placement without guessing", async () => {
    const db = { workroom: { findMany: vi.fn().mockResolvedValue([
      { capsuleId: "WC-REVIEW", title: "Review change", status: "blocked", backlogItemId: "BI-ONE", workItem: { teamId: "team-1", parentItemId: "parent-1", assignedToUserId: null, assignedToAgentId: "reviewer-1" } },
      { capsuleId: "WC-UNMAPPED", title: "Unmapped work", status: "working", backlogItemId: null, workItem: null },
    ]) } };
    const projection = await loadWorkroomCoordination(db, new Date("2026-09-06T12:00:00Z"));
    expect(projection.rooms[0]).toMatchObject({ roomId: "WC-REVIEW", teamId: "team-1", status: "blocked", parentItemId: "parent-1", href: "/workspace/cases/work-capsule%3AWC-REVIEW?operation=all" });
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


// The page led with a plan count that is zero on every install while hundreds of
// rooms were running, so an owner read "we have no rooms" (BI-0EB855CC). The
// inventory is the TOTAL, distinct from the bounded coordination sample, and it
// reports unplaced rooms rather than folding them into a portfolio — the rule
// PR #5189 set for teams, applied to rooms.
describe("loadRoomInventory", () => {
  it("counts open rooms by portfolio and reports the unclassified rather than defaulting them", async () => {
    const db = { workroom: { groupBy: vi.fn().mockResolvedValue([
      { portfolioRole: "foundational", _count: { _all: 71 } },
      { portfolioRole: "manufactureAndDeliver", _count: { _all: 13 } },
      { portfolioRole: null, _count: { _all: 367 } },
    ]) } };

    const inventory = await loadRoomInventory(db);

    expect(inventory.openTotal).toBe(451);
    expect(inventory.unclassified).toBe(367);
    expect(inventory.byRole.foundational).toBe(71);
    expect(inventory.byRole.manufactureAndDeliver).toBe(13);
    // A portfolio with no rooms reads zero, not absent.
    expect(inventory.byRole.forEmployees).toBe(0);
  });

  it("excludes completed and archived rooms, so the count matches what is open", async () => {
    const db = { workroom: { groupBy: vi.fn().mockResolvedValue([]) } };
    await loadRoomInventory(db);
    expect(db.workroom.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { archivedAt: null, status: { notIn: ["complete", "abandoned", "archived"] } },
    }));
  });

  it("does not fold an unrecognised portfolio value into a real portfolio", async () => {
    const db = { workroom: { groupBy: vi.fn().mockResolvedValue([
      { portfolioRole: "somethingElse", _count: { _all: 5 } },
    ]) } };
    const inventory = await loadRoomInventory(db);
    expect(inventory.unclassified).toBe(5);
    expect(inventory.byRole.foundational).toBe(0);
  });
});
