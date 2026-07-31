import { describe, expect, it } from "vitest";

import { persistBootstrapDiscoveryRun } from "./discovery-sync";
import { heapIntegrityRaw } from "../test/discovery-sync-test-support";

describe("persistBootstrapDiscoveryRun — one clock governs the run", () => {
  it("stamps startedAt from the same instant as the entities' lastSeenAt", async () => {
    // REGRESSION: `startedAt` was left to the schema's `@default(now())`, which
    // Postgres evaluates at INSERT time — a few ms AFTER the `now` this
    // transaction captures up front and writes as every observed entity's
    // `lastSeenAt`. The result was a run whose `startedAt` post-dated the
    // `lastSeenAt` of the entities it had just confirmed, so
    // `countStaleEntitiesSince(run.startedAt)` reported 100% of the active
    // estate as stale on every single sweep, and the run row recorded a
    // `completedAt` BEFORE its own `startedAt` (observed live on run
    // DISC-1785456604405: startedAt 00:10:04.438, completedAt 00:10:04.406).
    let runCreateData: Record<string, unknown> | undefined;
    const entityUpdates: Array<Record<string, unknown>> = [];

    const db = {
      $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => fn({
        ...heapIntegrityRaw(),
        discoveryRun: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            runCreateData = data;
            return { id: "run-clock" };
          },
        },
        inventoryEntity: {
          findMany: async () => [],
          upsert: async ({ where, update }: {
            where: { entityKey: string };
            update: Record<string, unknown>;
          }) => {
            entityUpdates.push(update);
            return { id: `entity:${where.entityKey}`, entityKey: where.entityKey };
          },
          updateMany: async () => ({ count: 0 }),
        },
        discoveredItem: {
          create: async ({ data }: { data: { observedKey: string } }) => ({
            id: `discovered:${data.observedKey}`,
          }),
        },
        discoveredSoftwareEvidence: { upsert: async () => ({}) },
        inventoryRelationship: {
          findMany: async () => [],
          upsert: async () => ({ id: "rel", relationshipKey: "rel" }),
          updateMany: async () => ({ count: 0 }),
        },
        discoveredRelationship: { create: async () => ({}) },
        portfolioQualityIssue: {
          findMany: async () => [],
          upsert: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
      }),
    };

    await persistBootstrapDiscoveryRun(
      db as never,
      {
        discoveredItems: [{
          discoveredKey: "dk:clock",
          sourceKind: "dpf_bootstrap",
          itemType: "host",
          name: "dk:clock",
          externalRef: "dk:clock",
          attributes: {},
        }],
        inventoryEntities: [{
          entityKey: "host:clock",
          entityType: "host",
          name: "host:clock",
          discoveredKey: "dk:clock",
          portfolioSlug: "foundational",
          taxonomyNodeId: "foundational/compute/servers",
          attributionStatus: "attributed" as const,
          attributionMethod: "rule" as const,
          attributionConfidence: 0.98,
          providerView: "foundational",
          properties: {},
        }],
        inventoryRelationships: [],
        softwareEvidence: [],
      } as never,
      { runKey: "run-clock", sourceSlug: "dpf_bootstrap" },
      {
        projectInventoryEntity: async () => undefined,
        projectInventoryRelationship: async () => undefined,
      },
    );

    const startedAt = runCreateData?.startedAt as Date | undefined;
    const completedAt = runCreateData?.completedAt as Date | undefined;

    // startedAt is written explicitly rather than deferred to the DB default...
    expect(startedAt).toBeInstanceOf(Date);
    // ...it never post-dates completion...
    expect(startedAt!.getTime()).toBeLessThanOrEqual(completedAt!.getTime());

    // ...and no entity this run confirmed is older than the run itself, which is
    // the exact predicate countStaleEntitiesSince() evaluates.
    expect(entityUpdates).not.toHaveLength(0);
    for (const update of entityUpdates) {
      const lastSeenAt = update.lastSeenAt as Date;
      expect(lastSeenAt).toBeInstanceOf(Date);
      expect(lastSeenAt.getTime()).toBeGreaterThanOrEqual(startedAt!.getTime());
    }
  });
});
