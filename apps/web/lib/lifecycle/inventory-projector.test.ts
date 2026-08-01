import { describe, expect, it } from "vitest";
import {
  projectInventoryLifecycle,
  type InventoryLifecycleProjectorClient,
  type InventoryLifecycleRow,
} from "./inventory-projector";
import type { ExistingGap } from "./gaps";

function row(over: Partial<InventoryLifecycleRow> = {}): InventoryLifecycleRow {
  return {
    id: "inventory-1",
    name: "Database Server",
    status: "active",
    supportStatus: "supported",
    lastSeenAt: new Date("2026-06-07T00:00:00Z"),
    lastConfirmedRunId: "RUN-1",
    digitalProductId: null,
    catalogIdentity: {
      id: "catalog-1",
      lifecycleMilestones: [{ milestone: "eol", date: new Date("2026-01-01T00:00:00Z"), confidence: 0.9 }],
    },
    ...over,
  };
}

function makeClient(input: { rows: InventoryLifecycleRow[]; total?: number; gaps?: ExistingGap[] }) {
  const calls = {
    inventoryCount: [] as unknown[],
    inventoryFindMany: [] as unknown[],
    membershipsCreated: 0,
    gapsCreated: 0,
    gapsUpdated: [] as unknown[],
  };
  const client: InventoryLifecycleProjectorClient = {
    inventoryEntity: {
      count: async (args) => {
        calls.inventoryCount.push(args);
        return input.total ?? input.rows.length;
      },
      findMany: async (args) => {
        calls.inventoryFindMany.push(args);
        return input.rows;
      },
    },
    eaNotation: { findUnique: async () => ({ id: "notation-1" }) },
    eaElementType: { findUnique: async () => ({ id: "plateau-type-1" }) },
    eaElement: {
      findFirst: async () => ({ id: "plateau-1" }),
      create: async () => ({ id: "plateau-1" }),
    },
    plateauMembership: {
      findMany: async () => [],
      create: async () => {
        calls.membershipsCreated += 1;
        return { id: "membership-1" };
      },
      update: async () => ({}),
    },
    lifecycleEvent: { create: async () => ({ id: "event-1" }) },
    lifecycleGap: {
      findMany: async () => input.gaps ?? [],
      create: async () => {
        calls.gapsCreated += 1;
        return { id: "gap-1" };
      },
      update: async (args) => {
        calls.gapsUpdated.push(args);
        return {};
      },
    },
  };
  return { client, calls };
}

describe("projectInventoryLifecycle", () => {
  it("projects current inventory and persists catalog-backed currency gaps", async () => {
    const { client, calls } = makeClient({ rows: [row()] });
    const result = await projectInventoryLifecycle(client, {
      limit: 100,
      upstreamEvidenceComplete: true,
      now: new Date("2026-06-07T00:00:00Z"),
    });

    expect(result.evidenceComplete).toBe(true);
    expect(result.baseline.summary.opened).toBe(1);
    expect(result.gaps.created).toBe(1);
    expect(calls).toMatchObject({ membershipsCreated: 1, gapsCreated: 1 });
    expect(calls.inventoryCount).toEqual([{
      where: { mergedIntoId: null, status: { not: "inactive" } },
    }]);
    expect(calls.inventoryFindMany).toEqual([
      expect.objectContaining({
        where: { mergedIntoId: null, status: { not: "inactive" } },
      }),
    ]);
  });

  it("preserves unseen gaps when the bounded inventory page is incomplete", async () => {
    const existing: ExistingGap = {
      id: "gap-unseen",
      gapKey: "technology-currency:InventoryEntity:unseen:baseline:plateau-1",
      status: "open",
      severity: "high",
      title: "Unseen asset is unsupported",
      detail: null,
    };
    const { client, calls } = makeClient({
      rows: [row({ supportStatus: "supported", catalogIdentity: null })],
      total: 2,
      gaps: [existing],
    });
    const result = await projectInventoryLifecycle(client, {
      limit: 1,
      upstreamEvidenceComplete: true,
      now: new Date("2026-06-07T00:00:00Z"),
    });

    expect(result.evidenceComplete).toBe(false);
    expect(result.gaps).toMatchObject({ resolved: 0, preserved: 1 });
    expect(calls.gapsUpdated).toHaveLength(0);
  });
});
