import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";

import {
  buildArchetypeRoomDefinitions,
  projectArchetypeRoomDefinitions,
} from "./archetype-room-definition-projection";

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
  const rows = new Map<string, { id: string; name: string; properties: Record<string, unknown> }>();
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
          .map((row) => ({ id: row.id }));
      },
      create: async (args: unknown) => {
        const data = (args as { data: { name: string; properties: Record<string, unknown> } }).data;
        seq += 1;
        const id = `el-${seq}`;
        rows.set(id, { id, name: data.name, properties: data.properties });
        return { id };
      },
      update: async (args: unknown) => {
        const { where, data } = args as {
          where: { id: string };
          data: { name: string; properties: Record<string, unknown> };
        };
        rows.set(where.id, { id: where.id, name: data.name, properties: data.properties });
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

  it("prunes rooms the archetype no longer declares", async () => {
    const db = fakeDb();
    const rescue = ovsmFor("pet-rescue");
    await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm: rescue });

    // The org changes archetype; the previous rooms must not survive.
    const shelter = ovsmFor("animal-shelter");
    const result = await projectArchetypeRoomDefinitions({ db, orgId: "org-1", ovsm: shelter });

    expect(result.removed).toBeGreaterThan(0);
    expect(db.rows.size).toBe(shelter.stages.length);
    const stageKeys = [...db.rows.values()].map(
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
