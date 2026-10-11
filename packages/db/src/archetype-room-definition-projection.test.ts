import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";

import {
  buildArchetypeRoomDefinitions,
  projectArchetypeRoomDefinitions,
  withArchetypeProjectionTransaction,
} from "./archetype-room-definition-projection";

it("reuses a caller transaction even when Prisma exposes nested transactions", async () => {
  const tx = {
    $queryRawUnsafe: async () => [],
    $transaction: async () => { throw new Error("unexpected nested transaction"); },
  };
  await withArchetypeProjectionTransaction(tx, "org-test", async (sameTx) => {
    expect(Object.is(sameTx, tx)).toBe(true);
  });
});

it("opens one transaction for a root client and locks inside it", async () => {
  const calls: string[] = [];
  const tx = { $queryRawUnsafe: async () => { calls.push("lock"); } };
  const db = {
    $connect: async () => {},
    $transaction: async (work: (value: unknown) => Promise<unknown>) => {
      calls.push("transaction");
      return work(tx);
    },
  };
  await withArchetypeProjectionTransaction(db, "org-test", async (sameTx) => {
    expect(Object.is(sameTx, tx)).toBe(true);
    calls.push("work");
  });
  expect(calls).toEqual(["transaction", "lock", "work"]);
});

function ovsmFor(archetypeId: string) {
  const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!archetype) throw new Error(`test archetype not found: ${archetypeId}`);
  return deriveOperationalValueStream(archetype);
}

/**
 * Minimal in-memory stand-in for the narrow RoomDefinitionDb surface. Keyed the
 * same way the projection is, so idempotence and pruning are observable.
 */
function fakeDb() {
  const rows = new Map<string, { id: string; name: string; properties: Record<string, unknown>; lifecycleStage: string; lifecycleStatus: string }>();
  const events: unknown[] = [];
  let seq = 0;

  const stageKeyOf = (properties: Record<string, unknown>): string =>
    (properties.projection as { stageKey: string }).stageKey;
  const orgIdOf = (properties: Record<string, unknown>): string =>
    (properties.projection as { orgId: string }).orgId;

  const matchPath = (args: unknown): { orgId?: string; stageKey?: string } => {
    const where = (args as { where?: { AND?: { properties: { path: string[]; equals: string } }[] } })
      .where;
    const out: { orgId?: string; stageKey?: string } = {};
    for (const clause of where?.AND ?? []) {
      const leaf = clause.properties.path[1];
      if (leaf === "orgId") out.orgId = clause.properties.equals;
      if (leaf === "stageKey") out.stageKey = clause.properties.equals;
    }
    return out;
  };

  return {
    rows,
    events,
    $queryRawUnsafe: async () => [],
    lifecycleEvent: { create: async (args: unknown) => { events.push(args); return { id: `event-${events.length}` }; } },
    eaNotation: { findUnique: async () => ({ id: "notation-1" }) },
    eaElementType: { findUnique: async () => ({ id: "stage-type-1" }) },
    eaElement: {
      findFirst: async (args: unknown) => {
        const { orgId, stageKey } = matchPath(args);
        for (const row of rows.values()) {
          if (orgIdOf(row.properties) === orgId && stageKeyOf(row.properties) === stageKey) {
            return { id: row.id };
          }
        }
        return null;
      },
      findMany: async (args: unknown) => {
        const { orgId } = matchPath(args);
        return [...rows.values()]
          .filter((row) => orgIdOf(row.properties) === orgId)
          .map((row) => ({ ...row }));
      },
      create: async (args: unknown) => {
        const data = (args as { data: { name: string; properties: Record<string, unknown> } }).data;
        seq += 1;
        const id = `el-${seq}`;
        rows.set(id, { id, name: data.name, properties: data.properties, lifecycleStage: "design", lifecycleStatus: "draft" });
        return { id };
      },
      update: async (args: unknown) => {
        const { where, data } = args as {
          where: { id: string };
          data: { name: string; properties: Record<string, unknown> };
        };
        rows.set(where.id, { ...rows.get(where.id)!, ...data });
        return { id: where.id };
      },
      deleteMany: async (args: unknown) => {
        const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
        let count = 0;
        for (const id of ids) if (rows.delete(id)) count += 1;
        return { count };
      },
    },
    eaViewElement: { deleteMany: async () => ({ count: 0 }) },
    eaRelationship: { deleteMany: async () => ({ count: 0 }) },
  };
}

describe("buildArchetypeRoomDefinitions", () => {
  it("inherits the stream role when the stage has no override", () => {
    const ovsm = ovsmFor("pet-rescue");
    const stage = { ...ovsm.stages[0]!, responsibleRole: null };
    const stream = ovsm.streams.find((s) => s.key === stage.streamKey)!;
    const result = buildArchetypeRoomDefinitions({ ...ovsm, stages: [stage] });
    expect(result.definitions[0]!.requiredParticipantRole).toBe(stream.responsibleRole);
  });
  it("maps every stage to exactly one room definition", () => {
    const ovsm = ovsmFor("pet-rescue");
    const set = buildArchetypeRoomDefinitions(ovsm);
    expect(set.definitions).toHaveLength(ovsm.stages.length);
    expect(set.definitions.map((d) => d.sourceKey)).toEqual(ovsm.stages.map((s) => s.key));
  });

  it("carries the stage contract onto the room: trigger, outcome, role, bindings", () => {
    const set = buildArchetypeRoomDefinitions(ovsmFor("pet-rescue"));
    const screening = set.definitions.find(
      (d) => d.sourceKey === "placement-application-screening",
    );
    expect(screening).toBeDefined();
    expect(screening!.trigger).toBeTruthy();
    expect(screening!.outcome).toBeTruthy();
    expect(screening!.requiredParticipantRole).toBeTruthy();
    expect(screening!.measureBindings).toContain("applications-in-screening");
  });

  it("stands a room for load-bearing work and closes the rest", () => {
    const ovsm = ovsmFor("pet-rescue");
    const set = buildArchetypeRoomDefinitions(ovsm);
    for (const definition of set.definitions) {
      const stage = ovsm.stages.find((s) => s.key === definition.sourceKey)!;
      expect(definition.mode).toBe(stage.loadBearing ? "standing" : "finite");
    }
  });

  it("never disagrees with the value-stream the EA canvas draws", () => {
    // Both projections read the same derived OVSM, so a room exists for exactly
    // the stages the diagram shows — no room without a stage, no stage without a room.
    for (const archetype of ALL_ARCHETYPES) {
      const ovsm = deriveOperationalValueStream(archetype);
      const set = buildArchetypeRoomDefinitions(ovsm);
      expect(new Set(set.definitions.map((d) => d.sourceKey))).toEqual(
        new Set(ovsm.stages.map((s) => s.key)),
      );
    }
  });

  it("carries a declared omission through so a missing room is explained", () => {
    const ovsm = ovsmFor("pet-rescue");
    const set = buildArchetypeRoomDefinitions({
      ...ovsm,
      declaredBackboneOmissions: [{ stageKey: "settle", reason: "Takes no money" }],
    });
    expect(set.declaredOmissions).toEqual([{ stageKey: "settle", reason: "Takes no money" }]);
  });
});

describe("projectArchetypeRoomDefinitions", () => {
  it("does not send notationId to EaElement (it belongs to EaElementType)", async () => {
    const db = fakeDb();
    const create = db.eaElement.create;
    db.eaElement.create = async (args: unknown) => {
      expect((args as { data: object }).data).not.toHaveProperty("notationId");
      return create(args);
    };
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm: ovsmFor("pet-rescue") });
  });

  it("preserves unrelated metadata during reconciliation", async () => {
    const db = fakeDb();
    const ovsm = ovsmFor("pet-rescue");
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm });
    const first = [...db.rows.values()][0]!;
    first.properties.operatorNote = "Keep this history";
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm });
    expect(db.rows.get(first.id)!.properties.operatorNote).toBe("Keep this history");
  });

  it("retains dropped rows and reuses their identities when the stage returns", async () => {
    const db = fakeDb();
    const ovsm = ovsmFor("pet-rescue");
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm });
    const ids = [...db.rows.keys()];
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm: { ...ovsm, stages: [] } });
    expect([...db.rows.keys()]).toEqual(ids);
    expect([...db.rows.values()].every((row) => row.lifecycleStatus === "inactive")).toBe(true);
    expect(db.events).toHaveLength(ids.length);
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm: { ...ovsm, stages: [] } });
    expect(db.events).toHaveLength(ids.length);
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm });
    expect([...db.rows.keys()]).toEqual(ids);
    expect([...db.rows.values()].every((row) => row.lifecycleStatus === "active")).toBe(true);
    expect(db.events).toHaveLength(ids.length * 2);
  });
  it("creates one row per stage on first projection", async () => {
    const db = fakeDb();
    const ovsm = ovsmFor("pet-rescue");
    const result = await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm });

    expect(result.created).toBe(ovsm.stages.length);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(db.rows.size).toBe(ovsm.stages.length);
  });

  it("is idempotent: re-projecting updates in place and creates nothing", async () => {
    const db = fakeDb();
    const ovsm = ovsmFor("pet-rescue");
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm });
    const sizeAfterFirst = db.rows.size;

    const second = await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(ovsm.stages.length);
    expect(second.removed).toBe(0);
    expect(db.rows.size).toBe(sizeAfterFirst);
  });

  it("withdraws rooms the archetype no longer declares without deleting history", async () => {
    const db = fakeDb();
    const rescue = ovsmFor("pet-rescue");
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm: rescue });

    // The org changes archetype; the previous rooms must not survive.
    const shelter = ovsmFor("animal-shelter");
    const result = await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm: shelter });

    expect(result.removed).toBeGreaterThan(0);
    const stageKeys = [...db.rows.values()].filter((row) => row.lifecycleStatus !== "inactive").map(
      (row) => (row.properties.projection as { stageKey: string }).stageKey,
    );
    expect(stageKeys.sort()).toEqual(shelter.stages.map((s) => s.key).sort());
  });

  it("keeps one org's rooms out of another's", async () => {
    const db = fakeDb();
    const ovsm = ovsmFor("pet-rescue");
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm });
    const second = await projectArchetypeRoomDefinitions({ db, orgId: "org-2", ovsm });

    expect(second.created).toBe(ovsm.stages.length);
    expect(second.removed).toBe(0);
    expect(db.rows.size).toBe(ovsm.stages.length * 2);
  });
});
