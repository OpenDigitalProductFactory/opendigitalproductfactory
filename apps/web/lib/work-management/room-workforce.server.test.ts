import { describe, expect, it } from "vitest";

import { loadRoomWorkforce, type RoomWorkforceDb } from "./room-workforce.server";

type Relation = { fromWorkroomId: string; toWorkroomId: string; relation: string };
type Participant = {
  workroomId: string;
  principalId: string;
  roles: string[];
  currentWorkSummary: string | null;
  principal: { displayName: string } | null;
};

function db(input: {
  relations?: Relation[];
  participants?: Participant[];
  owner?: string | null;
}): RoomWorkforceDb {
  const relations = input.relations ?? [];
  const participants = input.participants ?? [];
  return {
    workroomRelation: {
      async findMany(args: any) {
        const ids: string[] = args.where.toWorkroomId.in;
        const kinds: string[] = args.where.relation.in;
        return relations.filter((r) => ids.includes(r.toWorkroomId) && kinds.includes(r.relation));
      },
    },
    workroomParticipant: {
      async findMany(args: any) {
        const ids: string[] = args.where.workroomId.in;
        return participants.filter((p) => ids.includes(p.workroomId));
      },
    },
    organization: {
      async findFirst() {
        return { topAccountablePrincipalId: input.owner ?? null };
      },
    },
  };
}

const worker = (over: Partial<Participant> & { workroomId: string; principalId: string }): Participant => ({
  roles: ["contributor"],
  currentWorkSummary: null,
  principal: { displayName: `Name ${over.principalId}` },
  ...over,
});

describe("loadRoomWorkforce — accountability", () => {
  it("prefers the room's own accountable principal", async () => {
    const result = await loadRoomWorkforce(
      db({
        owner: "p-owner",
        participants: [worker({ workroomId: "r1", principalId: "p-room", roles: ["accountable"] })],
      }),
      { workroomId: "r1" },
    );
    expect(result.accountability).toMatchObject({ state: "resolved", principalId: "p-room", source: "explicit-room" });
    expect(result.accountableDisplayName).toBe("Name p-room");
  });

  it("inherits from an ancestor room along a responsibility relation", async () => {
    const result = await loadRoomWorkforce(
      db({
        owner: "p-owner",
        relations: [{ fromWorkroomId: "parent", toWorkroomId: "r1", relation: "contains" }],
        participants: [worker({ workroomId: "parent", principalId: "p-parent", roles: ["accountable"] })],
      }),
      { workroomId: "r1" },
    );
    expect(result.accountability).toMatchObject({ state: "resolved", principalId: "p-parent", source: "inherited-room" });
  });

  it("falls back to the organization's recorded owner, and never to anyone else", async () => {
    const result = await loadRoomWorkforce(
      db({ owner: "p-owner", participants: [worker({ workroomId: "r1", principalId: "p-worker" })] }),
      { workroomId: "r1" },
    );
    expect(result.accountability).toMatchObject({ state: "resolved", principalId: "p-owner", source: "organization-owner" });
  });

  it("reports setup-required when no owner is recorded rather than naming a participant", async () => {
    const result = await loadRoomWorkforce(
      db({ owner: null, participants: [worker({ workroomId: "r1", principalId: "p-worker" })] }),
      { workroomId: "r1" },
    );
    expect(result.accountability).toMatchObject({
      state: "setup-required",
      reason: "no-organization-owner-recorded",
    });
  });

  it("does not inherit across a relation that is not a responsibility relation", async () => {
    const result = await loadRoomWorkforce(
      db({
        owner: null,
        relations: [{ fromWorkroomId: "other", toWorkroomId: "r1", relation: "blocks" }],
        participants: [worker({ workroomId: "other", principalId: "p-other", roles: ["accountable"] })],
      }),
      { workroomId: "r1" },
    );
    // "blocks" links two rooms; it does not delegate answerability for the work.
    expect(result.accountability.state).toBe("setup-required");
  });
});

describe("loadRoomWorkforce — workers", () => {
  it("lists this room's workers and not an ancestor's", async () => {
    const result = await loadRoomWorkforce(
      db({
        owner: "p-owner",
        relations: [{ fromWorkroomId: "parent", toWorkroomId: "r1", relation: "contains" }],
        participants: [
          worker({ workroomId: "r1", principalId: "p-here" }),
          worker({ workroomId: "parent", principalId: "p-above" }),
        ],
      }),
      { workroomId: "r1" },
    );
    const names = result.groups.flatMap((g) => [g.parent, ...g.members]).filter(Boolean).map((w) => w!.workerId);
    expect(names).toContain("p-here");
    expect(names).not.toContain("p-above");
  });

  it("never claims a worker state the platform did not record", async () => {
    const result = await loadRoomWorkforce(
      db({
        owner: "p-owner",
        participants: [worker({ workroomId: "r1", principalId: "p1", currentWorkSummary: "Drafting the migration" })],
      }),
      { workroomId: "r1" },
    );
    const all = result.groups.flatMap((g) => [g.parent, ...g.members]).filter(Boolean);
    expect(all[0]!.state).toBe("unknown");
    expect(all[0]!.currentTask).toBe("Drafting the migration");
  });

  it("keeps unrecorded delegation as unknown parentage instead of inventing a parent", async () => {
    const result = await loadRoomWorkforce(
      db({
        owner: "p-owner",
        participants: [
          worker({ workroomId: "r1", principalId: "p1" }),
          worker({ workroomId: "r1", principalId: "p2" }),
        ],
      }),
      { workroomId: "r1" },
    );
    expect(result.groups.every((g) => g.parent === null && g.unknownParentage)).toBe(true);
  });

  it("bounds the roster at a hundred workers and reports the total", async () => {
    const participants = Array.from({ length: 100 }, (_, i) =>
      worker({ workroomId: "r1", principalId: `p-${String(i).padStart(3, "0")}` }),
    );
    const result = await loadRoomWorkforce(db({ owner: "p-owner", participants }), { workroomId: "r1" });
    const shown = result.groups.reduce((n, g) => n + g.members.length + (g.parent ? 1 : 0), 0);
    expect(result.matched).toBe(100);
    expect(result.partial).toBe(true);
    expect(shown).toBe(20);
  });

  it("finds one worker among a hundred by name or current task", async () => {
    const participants = Array.from({ length: 100 }, (_, i) =>
      worker({
        workroomId: "r1",
        principalId: `p-${i}`,
        principal: { displayName: `Worker ${i}` },
        currentWorkSummary: i === 42 ? "Reconciling the ledger" : null,
      }),
    );
    const byTask = await loadRoomWorkforce(db({ owner: "p-owner", participants }), {
      workroomId: "r1",
      query: "reconciling",
    });
    expect(byTask.matched).toBe(1);
  });

  it("stops at a responsibility cycle instead of walking forever", async () => {
    const result = await loadRoomWorkforce(
      db({
        owner: "p-owner",
        relations: [
          { fromWorkroomId: "r2", toWorkroomId: "r1", relation: "contains" },
          { fromWorkroomId: "r1", toWorkroomId: "r2", relation: "contains" },
        ],
        participants: [],
      }),
      { workroomId: "r1" },
    );
    expect(result.accountability.state).toBeDefined();
  });
});

describe("Prisma enum identifier boundary", () => {
  // The stored value is `spawned-from`; the generated client calls it
  // `spawned_from`. Querying with the stored value is rejected outright, and a
  // row read back in client spelling fails isResponsibilityRelation — so the
  // walk silently stops and every room falls back to the organization owner.
  // Only a real client surfaces this; a hand-written fake accepts both.
  it("queries relations in the client's spelling", async () => {
    let asked: string[] = [];
    const spy: RoomWorkforceDb = {
      workroomRelation: {
        async findMany(args: any) {
          asked = args.where.relation.in;
          return [];
        },
      },
      workroomParticipant: { async findMany() { return []; } },
      organization: { async findFirst() { return { topAccountablePrincipalId: "p-owner" }; } },
    };
    await loadRoomWorkforce(spy, { workroomId: "r1" });
    expect(asked).toContain("spawned_from");
    expect(asked).not.toContain("spawned-from");
  });

  it("inherits across a relation returned in the client's spelling", async () => {
    const spy: RoomWorkforceDb = {
      workroomRelation: {
        async findMany(args: any) {
          const ids: string[] = args.where.toWorkroomId.in;
          return ids.includes("r1")
            ? [{ fromWorkroomId: "parent", toWorkroomId: "r1", relation: "spawned_from" }]
            : [];
        },
      },
      workroomParticipant: {
        async findMany() {
          return [
            {
              workroomId: "parent",
              principalId: "p-parent",
              roles: ["accountable"],
              currentWorkSummary: null,
              principal: { displayName: "Parent Owner" },
            },
          ];
        },
      },
      organization: { async findFirst() { return { topAccountablePrincipalId: "p-owner" }; } },
    };
    const result = await loadRoomWorkforce(spy, { workroomId: "r1" });
    expect(result.accountability).toMatchObject({
      state: "resolved",
      principalId: "p-parent",
      source: "inherited-room",
    });
  });
});
