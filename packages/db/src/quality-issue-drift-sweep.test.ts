import { describe, expect, it, vi } from "vitest";

import { runQualityIssueDriftSweep, type DriftSweepDb } from "./quality-issue-drift-sweep";

const NOW = new Date("2026-07-24T12:00:00.000Z");

function makeDb(overrides: {
  grouped?: Array<{ issueType: string; _count: { _all: number } }>;
  candidates?: Array<{
    id: string;
    issueType: string;
    inventoryEntityId: string | null;
    inventoryRelationshipId: string | null;
  }>;
  entities?: Array<{ id: string; status: string }>;
  relationships?: Array<{ id: string; status: string }>;
}) {
  const updateMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
    count: where.id.in.length,
  }));
  const db: DriftSweepDb = {
    portfolioQualityIssue: {
      groupBy: vi.fn(async () => overrides.grouped ?? []),
      findMany: vi.fn(async () => overrides.candidates ?? []),
      updateMany,
    },
    inventoryEntity: {
      findMany: vi.fn(async () => overrides.entities ?? []),
    },
    inventoryRelationship: {
      findMany: vi.fn(async () => overrides.relationships ?? []),
    },
  };
  return { db, updateMany };
}

describe("runQualityIssueDriftSweep — drift detection", () => {
  it("reports over-budget queues worst-first with their owner, and healthy=false", async () => {
    const { db } = makeDb({
      grouped: [
        { issueType: "lifecycle_unverified", _count: { _all: 178 } },
        { issueType: "catalog_match_ambiguous", _count: { _all: 175 } },
      ],
    });

    const report = await runQualityIssueDriftSweep(db, NOW);

    expect(report.healthy).toBe(false);
    expect(report.drift.map((d) => d.type)).toEqual([
      "lifecycle_unverified",
      "catalog_match_ambiguous",
    ]);
    expect(report.drift[0]).toMatchObject({ open: 178, budget: 0, over: 178 });
    expect(report.drift[0].owner).toBe("coworker:estate-specialist");
    expect(report.scannedAt).toBe(NOW);
  });

  it("is healthy when every registered queue is at its steady state", async () => {
    const { db } = makeDb({ grouped: [{ issueType: "stale_entity", _count: { _all: 0 } }] });
    const report = await runQualityIssueDriftSweep(db, NOW);
    expect(report.healthy).toBe(true);
    expect(report.drift).toEqual([]);
  });

  it("ignores an unregistered legacy type rather than inventing a budget", async () => {
    const { db } = makeDb({
      grouped: [
        { issueType: "some_legacy_type", _count: { _all: 999 } },
        { issueType: "stale_entity", _count: { _all: 3 } },
      ],
    });
    const report = await runQualityIssueDriftSweep(db, NOW);
    expect(report.openByType).not.toHaveProperty("some_legacy_type");
    expect(report.drift.map((d) => d.type)).toEqual(["stale_entity"]);
  });
});

describe("runQualityIssueDriftSweep — recovery backstop (self-heal)", () => {
  it("resolves a stale issue whose linked entity is active again", async () => {
    const { db, updateMany } = makeDb({
      grouped: [],
      candidates: [
        { id: "qi-1", issueType: "stale_entity", inventoryEntityId: "e-1", inventoryRelationshipId: null },
        { id: "qi-2", issueType: "stale_entity", inventoryEntityId: "e-2", inventoryRelationshipId: null },
      ],
      entities: [
        { id: "e-1", status: "active" }, // recovered → resolve
        { id: "e-2", status: "stale" }, // still stale → keep
      ],
    });

    const report = await runQualityIssueDriftSweep(db, NOW);

    expect(report.autoResolved).toEqual({ stale_entity: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["qi-1"] } },
      data: { status: "resolved", resolvedAt: NOW },
    });
  });

  it("resolves a stale issue whose linked entity was deleted (absent from lookup)", async () => {
    const { db, updateMany } = makeDb({
      candidates: [
        { id: "qi-3", issueType: "stale_relationship", inventoryEntityId: null, inventoryRelationshipId: "r-1" },
      ],
      relationships: [], // r-1 no longer exists → resolve
    });

    const report = await runQualityIssueDriftSweep(db, NOW);

    expect(report.autoResolved).toEqual({ stale_relationship: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["qi-3"] } },
      data: { status: "resolved", resolvedAt: NOW },
    });
  });

  it("resolves nothing when there are no FK-linked candidates (the common case today)", async () => {
    const { db, updateMany } = makeDb({ candidates: [], grouped: [] });
    const report = await runQualityIssueDriftSweep(db, NOW);
    expect(report.autoResolved).toEqual({});
    expect(updateMany).not.toHaveBeenCalled();
  });
});
