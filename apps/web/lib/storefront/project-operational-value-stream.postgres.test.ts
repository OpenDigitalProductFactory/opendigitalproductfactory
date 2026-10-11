import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../../../packages/db/generated/client/client";
import { seedEaArchimate4 } from "../../../../packages/db/src/seed-ea-archimate4";
import { projectOperationalValueStreamForArchetype } from "./project-operational-value-stream";
// The shared integration runner executes the web suite. Include the package's
// persistence contract here so database evidence is not silently skipped by it.
import "../../../../packages/db/src/archetype-room-definition-projection.postgres.test";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const orgId = `room-orchestration-test-${randomUUID()}`;
let db: PrismaClient;

describeDatabase("production OVSM orchestration with PostgreSQL", () => {
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await seedEaArchimate4();
  }, 30_000);
  afterAll(async () => { if (db) await db.$disconnect(); });

  it("rolls back the real EA writes when the room write fails", async () => {
    const failingDb = db.$extends({ query: { eaElement: {
      async create({ args, query }) {
        const properties = args.data.properties as { projection?: { source?: string } } | undefined;
        if (properties?.projection?.source === "archetype-room-definition") {
          throw new Error("injected room persistence failure");
        }
        return query(args);
      },
    } } });
    await expect(projectOperationalValueStreamForArchetype({
      db: failingDb, organizationId: orgId, archetypeId: "pet-rescue",
    })).rejects.toThrow("injected room persistence failure");
    expect(await db.eaView.count({ where: { scopeRef: `${orgId}:operational` } })).toBe(0);
    expect(await db.eaElement.count({ where: { properties: { path: ["projection", "orgId"], equals: orgId } } })).toBe(0);
  }, 30_000);

  it("creates both projections in the supplied transaction and rolls back with its caller", async () => {
    await expect(db.$transaction(async (tx) => {
      const result = await projectOperationalValueStreamForArchetype({ db: tx, organizationId: orgId, archetypeId: "pet-rescue" });
      expect(result.roomDefinitions.created).toBeGreaterThan(0);
      expect(await tx.eaView.count({ where: { id: result.viewId } })).toBe(1);
      expect(await tx.eaElement.count({ where: { AND: [
        { properties: { path: ["projection", "orgId"], equals: orgId } },
        { properties: { path: ["projection", "source"], equals: "archetype-room-definition" } },
      ] } })).toBe(result.roomDefinitions.definitionCount);
      throw new Error("caller rolls back both projections");
    }, { timeout: 30_000 })).rejects.toThrow("caller rolls back both projections");
    expect(await db.eaView.count({ where: { scopeRef: `${orgId}:operational` } })).toBe(0);
    expect(await db.eaElement.count({ where: { properties: { path: ["projection", "orgId"], equals: orgId } } })).toBe(0);
  }, 30_000);
});
