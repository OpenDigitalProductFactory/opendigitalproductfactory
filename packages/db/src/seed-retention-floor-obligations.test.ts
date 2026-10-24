import { describe, expect, it } from "vitest";

import { seedRetentionFloorObligations } from "./seed-retention-floor-obligations";

// BI-0C723E18. The pure planner is covered by
// apps/web/lib/operate/retention/obligation-floors.test.ts. What is NOT pure,
// and is the subtle half of this fix, is what the seed does to a row that
// already exists on the WRONG regulation. The first cut deleted it; deleting an
// Obligation orphans its linked controls and collected evidence, so the row is
// re-pointed in place instead. These tests pin that.

type ObligationRow = {
  id: string;
  regulationId: string;
  reference: string;
  retentionMinimumDays?: number | null;
};

/**
 * The narrow slice of PrismaClient this seed touches, recording what it did.
 * A fake rather than a mock of the real client: the assertions are about the
 * SHAPE of the writes (update vs create vs delete), which is exactly what a
 * mocked client would let us get wrong.
 */
function fakePrisma(seeded: {
  regulations: { id: string; regulationId: string; applicability: unknown }[];
  obligations: ObligationRow[];
}) {
  const obligations = [...seeded.obligations];
  const calls = { created: 0, updated: 0, deleted: 0, moves: [] as string[] };

  return {
    calls,
    obligations,
    client: {
      regulation: {
        findMany: async () => seeded.regulations,
      },
      obligation: {
        findFirst: async ({ where }: { where: { reference?: string; regulationId?: string } }) => {
          const hit = obligations.find(
            (o) =>
              (where.reference === undefined || o.reference === where.reference)
              && (where.regulationId === undefined || o.regulationId === where.regulationId),
          );
          return hit ? { id: hit.id, regulationId: hit.regulationId } : null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = obligations.find((o) => o.id === where.id)!;
          if (typeof data.regulationId === "string" && data.regulationId !== row.regulationId) {
            calls.moves.push(`${row.reference}: ${row.regulationId} -> ${data.regulationId}`);
            row.regulationId = data.regulationId;
          }
          if (typeof data.retentionMinimumDays === "number") row.retentionMinimumDays = data.retentionMinimumDays;
          calls.updated += 1;
          return row;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row: ObligationRow = {
            id: `new-${obligations.length}`,
            regulationId: String(data.regulationId),
            reference: String(data.reference),
            retentionMinimumDays: data.retentionMinimumDays as number,
          };
          obligations.push(row);
          calls.created += 1;
          return row;
        },
        // Present so an accidental reintroduction of the delete path is caught
        // by an assertion rather than by a missing-method crash.
        deleteMany: async () => {
          calls.deleted += 1;
          return { count: 0 };
        },
      },
    },
  };
}

const PUBLIC_SECTOR_REGULATIONS = [
  { id: "db-epa", regulationId: "REG-US-EPA-NPDES", applicability: { archetypes: ["public-sector"] } },
  { id: "db-rec", regulationId: "REG-US-STATE-PUBLIC-RECORDS", applicability: { archetypes: ["public-sector"] } },
];

describe("seedRetentionFloorObligations — re-pointing a misattributed floor", () => {
  it("moves the existing row to the named regulation instead of creating a second one", async () => {
    const fake = fakePrisma({
      regulations: PUBLIC_SECTOR_REGULATIONS,
      // What an install seeded before the fix: the floor on the Clean Water Act.
      obligations: [
        { id: "obl-1", regulationId: "db-epa", reference: "retention/floor/public-sector", retentionMinimumDays: 1095 },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedRetentionFloorObligations(fake.client as any);

    const rows = fake.obligations.filter((o) => o.reference === "retention/floor/public-sector");
    expect(rows, "the floor must not be duplicated across two regulations").toHaveLength(1);
    expect(rows[0].id, "the row keeps its identity, so its controls and evidence survive").toBe("obl-1");
    expect(rows[0].regulationId).toBe("db-rec");
    // The write carries the DATABASE key, not the human regulationId — the
    // seed's own log renders the human one separately.
    expect(fake.calls.moves).toContain("retention/floor/public-sector: db-epa -> db-rec");
  });

  it("destroys nothing — the stale citation is moved, never deleted", async () => {
    const fake = fakePrisma({
      regulations: PUBLIC_SECTOR_REGULATIONS,
      obligations: [
        { id: "obl-1", regulationId: "db-epa", reference: "retention/floor/public-sector", retentionMinimumDays: 1095 },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedRetentionFloorObligations(fake.client as any);

    expect(fake.calls.deleted, "delete-and-recreate orphans linked controls and evidence").toBe(0);
  });

  it("leaves a correctly-cited row where it is", async () => {
    const fake = fakePrisma({
      regulations: PUBLIC_SECTOR_REGULATIONS,
      obligations: [
        { id: "obl-1", regulationId: "db-rec", reference: "retention/floor/public-sector", retentionMinimumDays: 1095 },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedRetentionFloorObligations(fake.client as any);

    expect(fake.calls.moves).toEqual([]);
    expect(fake.obligations.find((o) => o.id === "obl-1")?.regulationId).toBe("db-rec");
  });

  it("creates the floor on a fresh install, with nothing to move", async () => {
    const fake = fakePrisma({ regulations: PUBLIC_SECTOR_REGULATIONS, obligations: [] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedRetentionFloorObligations(fake.client as any);

    const rows = fake.obligations.filter((o) => o.reference === "retention/floor/public-sector");
    expect(rows).toHaveLength(1);
    expect(rows[0].regulationId).toBe("db-rec");
    expect(fake.calls.moves).toEqual([]);
    expect(fake.calls.deleted).toBe(0);
  });
});
