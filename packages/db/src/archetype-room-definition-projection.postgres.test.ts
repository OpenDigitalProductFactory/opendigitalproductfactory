import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";
import { PrismaClient } from "../generated/client/client";
import { projectArchetypeRoomDefinitions, withArchetypeProjectionTransaction } from "./archetype-room-definition-projection";
import { seedEaArchimate4 } from "./seed-ea-archimate4";

// Run only in the governed PostgreSQL test environment. No live credentials or
// production organization IDs belong in this suite.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const prefix = `room-projection-test-${randomUUID()}`;
const orgIds = [prefix, `${prefix}-other`, `${prefix}-rollback`];
const ovsm = deriveOperationalValueStream(ALL_ARCHETYPES.find((a) => a.archetypeId === "pet-rescue")!);
let db: PrismaClient;
const where = (orgId: string) => ({ AND: [
  { properties: { path: ["projection", "source"], equals: "archetype-room-definition" } },
  { properties: { path: ["projection", "orgId"], equals: orgId } },
] });

describeDatabase("archetype room projection with generated Prisma and PostgreSQL", () => {
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await db.$connect();
    // The shared gate starts from migrations, not a fully installed portal.
    // Use the real reference seed rather than inventing a permissive meta-model.
    await seedEaArchimate4();
    const notation = await db.eaNotation.findUnique({ where: { slug: "archimate4" } });
    expect(notation, "shared test database must have the canonical EA seed").not.toBeNull();
  }, 30_000);
  afterAll(async () => {
    if (!db) return;
    const rows = await db.eaElement.findMany({ where: { OR: orgIds.map(where) }, select: { id: true } });
    const ids = rows.map((row) => row.id);
    await db.eaRelationship.deleteMany({ where: { OR: [{ fromElementId: { in: ids } }, { toElementId: { in: ids } }] } });
    await db.eaViewElement.deleteMany({ where: { elementId: { in: ids } } });
    await db.eaView.deleteMany({ where: { scopeRef: prefix } });
    await db.lifecycleEvent.deleteMany({ where: { governedThingKind: "EaElement", governedThingId: { in: ids } } });
    await db.eaElement.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  it("serializes concurrent creation and preserves bindings and tenant isolation", async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () =>
      projectArchetypeRoomDefinitions({ db, orgId: prefix, ovsm })));
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(ovsm.stages.length);
    const rows = await db.eaElement.findMany({ where: where(prefix), orderBy: { id: "asc" } });
    expect(rows).toHaveLength(ovsm.stages.length);
    const declared = rows[0]!.properties as { roomDefinition: { gateBindings: string[]; measureBindings: string[]; sourceKey: string } };
    const stage = ovsm.stages.find((s) => s.key === declared.roomDefinition.sourceKey)!;
    expect(declared.roomDefinition.gateBindings).toEqual(stage.trustGateKeys);
    expect(declared.roomDefinition.measureBindings).toEqual(stage.metricBindings);
    await projectArchetypeRoomDefinitions({ db, orgId: orgIds[1]!, ovsm });
    expect(await db.eaElement.count({ where: where(orgIds[1]!) })).toBe(ovsm.stages.length);
    expect(await db.eaElement.findMany({ where: where(prefix), orderBy: { id: "asc" } })).toEqual(rows);
  }, 30_000);

  it("withdraws and restores the same rows, relationships, view references and audit trail", async () => {
    await projectArchetypeRoomDefinitions({ db, orgId: prefix, ovsm });
    const rows = await db.eaElement.findMany({ where: where(prefix), orderBy: { id: "asc" } });
    const first = rows[0]!;
    await db.eaElement.update({ where: { id: first.id }, data: { properties: { ...first.properties as object, operatorNote: "retained" } } });
    const notation = await db.eaNotation.findUniqueOrThrow({ where: { slug: "archimate4" } });
    const type = await db.eaRelationshipType.findFirstOrThrow({ where: { notationId: notation.id } });
    const relationship = await db.eaRelationship.create({ data: { fromElementId: first.id, toElementId: rows[1]!.id, relationshipTypeId: type.id, notationSlug: notation.slug } });
    const view = await db.eaView.create({ data: { notationId: notation.id, name: prefix, layoutType: "manual", scopeType: "test", scopeRef: prefix } });
    const ref = await db.eaViewElement.create({ data: { viewId: view.id, elementId: first.id } });
    await projectArchetypeRoomDefinitions({ db, orgId: prefix, ovsm: { ...ovsm, stages: [] } });
    expect(await db.eaElement.count({ where: { ...where(prefix), lifecycleStatus: { not: "inactive" } } })).toBe(0);
    expect(await db.eaRelationship.findUnique({ where: { id: relationship.id } })).not.toBeNull();
    expect(await db.eaViewElement.findUnique({ where: { id: ref.id } })).not.toBeNull();
    await projectArchetypeRoomDefinitions({ db, orgId: prefix, ovsm });
    const restored = await db.eaElement.findMany({ where: where(prefix), orderBy: { id: "asc" } });
    expect(restored.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(restored[0]!.properties).toMatchObject({ operatorNote: "retained" });
    expect(await db.lifecycleEvent.count({ where: { governedThingKind: "EaElement", governedThingId: first.id } })).toBe(2);
  }, 30_000);

  it("rolls back projection with its caller and does not open a nested transaction", async () => {
    await expect(db.$transaction(async (tx) => {
      await withArchetypeProjectionTransaction(tx, orgIds[2]!, async (sameTx) => {
        // Compare identity without asking the assertion formatter to traverse
        // Prisma's recursive client proxy if this contract regresses.
        expect(Object.is(sameTx, tx)).toBe(true);
        await projectArchetypeRoomDefinitions({ db: sameTx, orgId: orgIds[2]!, ovsm });
        throw new Error("caller rollback");
      });
    }, { timeout: 30_000 })).rejects.toThrow("caller rollback");
    expect(await db.eaElement.count({ where: where(orgIds[2]!) })).toBe(0);
  }, 30_000);
});
