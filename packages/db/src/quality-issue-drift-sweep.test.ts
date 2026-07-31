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
      // The sweep now makes TWO candidate queries (subject-recovered and
      // subject-lost), each scoped to a disjoint set of issue types. A mock that
      // ignored `where` would hand every candidate to both passes and let one
      // pass resolve rows the other owns — so honour the issueType filter.
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const all = overrides.candidates ?? [];
        const filter = where.issueType as { in?: string[] } | undefined;
        if (!filter?.in) return all;
        return all.filter((candidate) => filter.in!.includes(candidate.issueType));
      }),
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

describe("runQualityIssueDriftSweep — subject-loss backstop (the dual)", () => {
  it("resolves an identity issue whose entity has gone stale", async () => {
    const { db, updateMany } = makeDb({
      grouped: [],
      candidates: [
        {
          id: "qi-10",
          issueType: "catalog_match_ambiguous",
          inventoryEntityId: "e-10",
          inventoryRelationshipId: null,
        },
        {
          id: "qi-11",
          issueType: "catalog_match_ambiguous",
          inventoryEntityId: "e-11",
          inventoryRelationshipId: null,
        },
      ],
      entities: [
        { id: "e-10", status: "stale" }, // subject gone → nobody can review it → resolve
        { id: "e-11", status: "active" }, // still on the network → genuinely actionable → keep
      ],
    });

    const report = await runQualityIssueDriftSweep(db, NOW);

    expect(report.autoResolved).toEqual({ catalog_match_ambiguous: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["qi-10"] } },
      data: { status: "resolved", resolvedAt: NOW },
    });
  });

  it("resolves a lifecycle issue whose entity no longer exists at all", async () => {
    const { db } = makeDb({
      candidates: [
        {
          id: "qi-12",
          issueType: "lifecycle_unverified",
          inventoryEntityId: "e-gone",
          inventoryRelationshipId: null,
        },
      ],
      entities: [], // absent from the canonical lookup → resolve
    });

    const report = await runQualityIssueDriftSweep(db, NOW);

    expect(report.autoResolved).toEqual({ lifecycle_unverified: 1 });
  });

  it("leaves an issue with no subject link alone rather than guessing", async () => {
    const { db, updateMany } = makeDb({
      candidates: [
        {
          id: "qi-13",
          issueType: "catalog_match_ambiguous",
          inventoryEntityId: null,
          inventoryRelationshipId: null,
        },
      ],
      entities: [],
    });

    const report = await runQualityIssueDriftSweep(db, NOW);

    expect(report.autoResolved).toEqual({});
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("never resolves a stale_entity row by the subject-loss rule — that is the recovery pass's dual, and would close every genuine staleness signal", async () => {
    const { db, updateMany } = makeDb({
      candidates: [
        {
          id: "qi-14",
          issueType: "stale_entity",
          inventoryEntityId: "e-14",
          inventoryRelationshipId: null,
        },
      ],
      entities: [{ id: "e-14", status: "stale" }],
    });

    const report = await runQualityIssueDriftSweep(db, NOW);

    expect(report.autoResolved).toEqual({});
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("sums both directions into one autoResolved tally", async () => {
    const { db } = makeDb({
      candidates: [
        {
          id: "qi-15",
          issueType: "stale_entity",
          inventoryEntityId: "e-15",
          inventoryRelationshipId: null,
        },
        {
          id: "qi-16",
          issueType: "lifecycle_unverified",
          inventoryEntityId: "e-16",
          inventoryRelationshipId: null,
        },
      ],
      entities: [
        { id: "e-15", status: "active" }, // recovered → recovery pass resolves
        { id: "e-16", status: "stale" }, // lost → subject-loss pass resolves
      ],
    });

    const report = await runQualityIssueDriftSweep(db, NOW);

    expect(report.autoResolved).toEqual({ stale_entity: 1, lifecycle_unverified: 1 });
  });
});
