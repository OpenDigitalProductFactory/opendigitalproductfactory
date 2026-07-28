import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../generated/client/client";
import type { NormalizedDiscoveryOutput } from "./discovery-normalize";
import { persistBootstrapDiscoveryRun } from "./discovery-sync";
import { lockInventoryEntityKeys } from "./inventory-entity-heap-integrity";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const suffix = randomUUID().replaceAll("-", "");
const entityKey = `inventory-integrity-test:${suffix}`;
const discoveredKey = `inventory-integrity-observation:${suffix}`;
const sourceSlug = `inventory-integrity-source-${suffix}`;
const runKeys = [
  `inventory-integrity-${suffix}-1`,
  `inventory-integrity-${suffix}-2`,
  `inventory-integrity-${suffix}-3`,
  `inventory-integrity-${suffix}-4`,
];

let db: PrismaClient;

const normalized: NormalizedDiscoveryOutput = {
  discoveredItems: [{
    discoveredKey,
    sourceKind: "integration_test",
    itemType: "host",
    name: "Inventory integrity fixture",
    externalRef: entityKey,
    attributes: { fixture: true },
  }],
  inventoryEntities: [{
    entityKey,
    entityType: "host",
    name: "Inventory integrity fixture",
    discoveredKey,
    attributionStatus: "attributed",
    attributionMethod: "rule",
    attributionConfidence: 1,
    providerView: "foundational",
    properties: { fixture: true },
  }],
  inventoryRelationships: [],
  softwareEvidence: [],
};

const noProjection = {
  projectInventoryEntity: async () => undefined,
  projectInventoryRelationship: async () => undefined,
};

async function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describeDatabase("persistBootstrapDiscoveryRun with PostgreSQL", () => {
  beforeAll(async () => {
    const adapter = new PrismaPg({ connectionString: databaseUrl! });
    db = new PrismaClient({ adapter });
    await db.$connect();
  });

  afterAll(async () => {
    if (!db) return;
    const entity = await db.inventoryEntity.findUnique({
      where: { entityKey },
      select: { id: true },
    });
    if (entity) {
      await db.inventoryEntity.update({
        where: { id: entity.id },
        data: { lastConfirmedRun: { disconnect: true } },
      });
    }
    await db.discoveryRun.deleteMany({ where: { runKey: { in: runKeys } } });
    if (entity) {
      await db.portfolioQualityIssue.deleteMany({
        where: { inventoryEntityId: entity.id },
      });
      await db.inventoryEntity.delete({ where: { id: entity.id } });
    }
    await db.$disconnect();
  });

  it("keeps one heap row and full provenance across sequential and concurrent ingestion", async () => {
    const first = await persistBootstrapDiscoveryRun(
      db as never,
      normalized,
      { runKey: runKeys[0]!, sourceSlug },
      noProjection,
    );
    const second = await persistBootstrapDiscoveryRun(
      db as never,
      normalized,
      { runKey: runKeys[1]!, sourceSlug },
      noProjection,
    );
    const concurrent = await Promise.all([
      persistBootstrapDiscoveryRun(
        db as never,
        normalized,
        { runKey: runKeys[2]!, sourceSlug },
        noProjection,
      ),
      persistBootstrapDiscoveryRun(
        db as never,
        normalized,
        { runKey: runKeys[3]!, sourceSlug },
        noProjection,
      ),
    ]);

    expect(first).toMatchObject({ createdEntities: 1, updatedEntities: 0 });
    expect(second).toMatchObject({ createdEntities: 0, updatedEntities: 1 });
    expect(concurrent).toEqual([
      expect.objectContaining({ createdEntities: 0, updatedEntities: 1 }),
      expect.objectContaining({ createdEntities: 0, updatedEntities: 1 }),
    ]);

    const heapRows = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
      await tx.$executeRawUnsafe("SET LOCAL enable_indexonlyscan = off");
      await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
      return tx.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count
           FROM "InventoryEntity"
          WHERE "entityKey" = $1`,
        entityKey,
      );
    });
    expect(Number(heapRows[0]?.count ?? 0)).toBe(1);

    const persisted = await db.inventoryEntity.findUniqueOrThrow({
      where: { entityKey },
      select: {
        id: true,
        discoveredItems: {
          where: { discoveryRun: { runKey: { in: runKeys } } },
          select: { id: true },
        },
      },
    });
    expect(persisted.discoveredItems).toHaveLength(4);
  }, 30_000);

  it("serializes reversed overlapping key sets without deadlock", async () => {
    const keys = [
      `inventory-lock-a:${suffix}`,
      `inventory-lock-b:${suffix}`,
    ];
    let releaseFirst!: () => void;
    let markFirstLocked!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstLocked = new Promise<void>((resolve) => {
      markFirstLocked = resolve;
    });
    let secondAcquired = false;

    const first = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      await lockInventoryEntityKeys(tx, keys);
      markFirstLocked();
      await holdFirst;
    }, { timeout: 5_000 });

    await within(firstLocked, 3_000, "first advisory lock was not acquired");
    const second = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      await lockInventoryEntityKeys(tx, [...keys].reverse());
      secondAcquired = true;
    }, { timeout: 5_000 });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(secondAcquired).toBe(false);
    releaseFirst();

    await expect(within(
      Promise.all([first, second]),
      5_000,
      "advisory lock test timed out",
    )).resolves.toBeDefined();
    expect(secondAcquired).toBe(true);
  }, 10_000);
});
