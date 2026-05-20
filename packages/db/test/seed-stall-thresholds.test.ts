import { describe, expect, it, vi } from "vitest";
import { seedStallThresholds, STALL_THRESHOLD_SEEDS } from "./seed-stall-thresholds";

interface FakeRow {
  scope: string;
  heartbeatTimeoutSeconds: number;
  totalPhaseTimeoutSeconds: number;
}

function makeFakePrisma(opts: { findManyOverride?: () => Promise<{ scope: string }[]> } = {}) {
  const rows = new Map<string, FakeRow>();
  return {
    rows,
    buildStudioStallThreshold: {
      upsert: vi.fn(async ({ where, create, update }: {
        where: { scope: string };
        create: FakeRow;
        update: Partial<FakeRow>;
      }) => {
        const existing = rows.get(where.scope);
        if (existing) {
          // mimic empty update — leave row untouched
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create };
        rows.set(where.scope, row);
        return row;
      }),
      findMany: opts.findManyOverride
        ? vi.fn(opts.findManyOverride)
        : vi.fn(async ({ where }: { where: { scope: { in: string[] } } }) => {
            return where.scope.in
              .filter((s) => rows.has(s))
              .map((s) => ({ scope: s }));
          }),
    },
  };
}

describe("seedStallThresholds", () => {
  it("upserts all six expected scopes on a fresh DB", async () => {
    const fake = makeFakePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedStallThresholds(fake as any);
    expect(fake.rows.size).toBe(6);
    for (const seed of STALL_THRESHOLD_SEEDS) {
      const row = fake.rows.get(seed.scope);
      expect(row).toBeDefined();
      expect(row!.heartbeatTimeoutSeconds).toBe(seed.heartbeatTimeoutSeconds);
      expect(row!.totalPhaseTimeoutSeconds).toBe(seed.totalPhaseTimeoutSeconds);
    }
  });

  it("is idempotent — re-running yields the same six rows", async () => {
    const fake = makeFakePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedStallThresholds(fake as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedStallThresholds(fake as any);
    expect(fake.rows.size).toBe(6);
  });

  it("never overwrites an existing operator-edited value on re-seed", async () => {
    const fake = makeFakePrisma();
    // First seed populates defaults.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedStallThresholds(fake as any);
    // Operator edits phase.build to a much larger value.
    fake.rows.get("phase.build")!.heartbeatTimeoutSeconds = 600;
    // Re-seed must not revert it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await seedStallThresholds(fake as any);
    expect(fake.rows.get("phase.build")!.heartbeatTimeoutSeconds).toBe(600);
  });

  it("throws if the post-seed invariant fails (a required scope is missing)", async () => {
    const fake = makeFakePrisma({
      findManyOverride: async () =>
        // Return only 5 of the 6 required scopes.
        STALL_THRESHOLD_SEEDS.slice(0, 5).map((s) => ({ scope: s.scope })),
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      seedStallThresholds(fake as any),
    ).rejects.toThrow(/invariant failed.*missing required scopes/);
  });
});
