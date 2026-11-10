import { describe, expect, it } from "vitest";

import {
  DEFAULT_STEWARD_BATCH_SIZE,
  MAX_STEWARD_BATCH_SIZE,
  resolveStewardBatchSize,
  runDemandScoringSteward,
  type DemandStewardDb,
  type DemandStewardRow,
} from "./scoring-steward";

type Row = DemandStewardRow & { owner?: "human" };

function row(over: Partial<DemandStewardRow> = {}): DemandStewardRow {
  return {
    id: `id-${over.itemId ?? "BI-1"}`,
    itemId: "BI-1",
    title: "A thing",
    body: null,
    status: "open",
    workType: "feature",
    source: "automated-detection",
    effortSize: "medium",
    occurrenceCount: 1,
    investmentBucket: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-05T00:00:00Z"),
    duplicateOfId: null,
    reach: null,
    impact: null,
    confidence: null,
    jobSize: null,
    demandScore: null,
    demandInputSource: null,
    estimateAiJobSize: null,
    estimateHumanJobSize: null,
    estimateAgreed: null,
    epic: null,
    _count: { demandEvidenceLinks: 0 },
    ...over,
  };
}

/**
 * In-memory fake that honours the guarded write the steward relies on: the
 * update lands only when the row is unchanged since it was read and no owner
 * has supplied inputs.
 */
function fakeDb(rows: Row[]) {
  const store = new Map(rows.map((r) => [r.id, { ...r } as Row & Record<string, unknown>]));
  const activities: Array<Record<string, unknown>> = [];
  let findManyArgs: Record<string, unknown> | null = null;
  const tx = {
    backlogItem: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const current = store.get(where.id as string);
        if (!current) return { count: 0 };
        const unchanged = (current.updatedAt as Date).getTime() === (where.updatedAt as Date).getTime();
        const notOwned = !["human", "agreed"].includes(String(current.demandInputSource));
        const unscored = current.demandScore === null;
        if (!unchanged || !notOwned || !unscored) return { count: 0 };
        store.set(current.id, { ...current, ...data });
        return { count: 1 };
      },
    },
    backlogItemActivity: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        activities.push(data);
        return data;
      },
    },
  };
  const db = {
    backlogItem: {
      findMany: async (args: Record<string, unknown>) => {
        findManyArgs = args;
        return [...store.values()];
      },
    },
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };
  return { db: db as unknown as DemandStewardDb, store, activities, findManyArgs: () => findManyArgs };
}

const NOW = new Date("2026-10-07T05:41:00Z");
const base = { agentId: "AGT-WS-PORTFOLIO", taskId: "demand-scoring-steward-daily", now: NOW };

describe("runDemandScoringSteward", () => {
  it("scores a bounded batch, highest likely value first (AC-1)", async () => {
    const rows = [
      row({ itemId: "BI-PLAIN" }),
      row({ itemId: "BI-EPIC", epic: { status: "in-progress" } }),
      row({ itemId: "BI-ASKED", source: "user-request" }),
    ];
    const { db, store } = fakeDb(rows);
    const result = await runDemandScoringSteward(db, { ...base, batchSize: 2 });
    expect(result.scored).toEqual(["BI-EPIC", "BI-ASKED"]);
    expect(result.eligible).toBe(3);
    expect(result.unscoredRemaining).toBe(1);
    expect(store.get("id-BI-PLAIN")!.demandScore).toBeNull();
    const epic = store.get("id-BI-EPIC")!;
    expect(epic.demandScore).toBeGreaterThan(0);
    expect(epic.demandScoreFramework).toBe("rice");
    expect(epic.impact).not.toBeNull();
    expect(epic.confidence).toBe(0.5);
  });

  it("marks the write agent-proposed with the agent and the basis (AC-2 provenance)", async () => {
    const { db, store, activities } = fakeDb([row({ itemId: "BI-1", workType: "bug" })]);
    await runDemandScoringSteward(db, { ...base, batchSize: 5 });
    const written = store.get("id-BI-1")!;
    expect(written.demandInputSource).toBe("ai");
    expect(written.demandInputActorRef).toBe("AGT-WS-PORTFOLIO");
    expect(written.demandInputAt).toEqual(NOW);
    expect(written.investmentBucket).toBe("run");
    // The effort estimate is attributed to the agent too, so the "who supplied
    // the effort estimate" blocker clears without claiming a human said so.
    expect(written.estimateAiJobSize).toBe(3);
    expect(written.estimateAiById).toBe("AGT-WS-PORTFOLIO");
    expect(written.estimateSource).toBe("ai");
    expect(activities).toHaveLength(1);
    const activity = activities[0]!;
    expect(activity.kind).toBe("demand_scored");
    expect(activity.recordedByAgentId).toBe("AGT-WS-PORTFOLIO");
    const payload = activity.payload as Record<string, unknown>;
    expect(payload.proposedBy).toBe("agent");
    expect(payload.inputSource).toBe("ai");
    expect(payload.stewardTaskId).toBe("demand-scoring-steward-daily");
    expect(Array.isArray(payload.basis) && (payload.basis as string[]).length).toBeGreaterThan(0);
  });

  it("never writes over an owner's inputs, even partial ones (AC-2 no-overwrite)", async () => {
    const owned = row({ itemId: "BI-OWNED", demandInputSource: "human", reach: 50 });
    const agreed = row({ itemId: "BI-AGREED", demandInputSource: "agreed", impact: 2 });
    const { db, store, activities } = fakeDb([owned, agreed]);
    const result = await runDemandScoringSteward(db, { ...base, batchSize: 10 });
    expect(result.scored).toEqual([]);
    expect(store.get("id-BI-OWNED")!.reach).toBe(50);
    expect(store.get("id-BI-OWNED")!.demandScore).toBeNull();
    expect(store.get("id-BI-AGREED")!.impact).toBe(2);
    expect(activities).toHaveLength(0);
  });

  it("asks the database only for rows it could score, so an owner's row is never even read", async () => {
    const { db, findManyArgs } = fakeDb([row()]);
    await runDemandScoringSteward(db, { ...base, batchSize: 1 });
    const where = (findManyArgs() as { where: Record<string, unknown> }).where;
    expect(where.demandScore).toBeNull();
    expect(where.duplicateOfId).toBeNull();
    expect(where.status).toEqual({ in: ["open", "in-progress"] });
    expect(where.OR).toEqual([{ demandInputSource: null }, { demandInputSource: "ai" }]);
  });

  it("backs off when an owner edits the item between read and write", async () => {
    const r = row({ itemId: "BI-RACE" });
    const { db, store } = fakeDb([r]);
    // The owner's edit lands after the read: bump updatedAt and claim the inputs.
    const originalFindMany = db.backlogItem.findMany.bind(db.backlogItem);
    (db.backlogItem as { findMany: unknown }).findMany = async (args: never) => {
      const read = await originalFindMany(args);
      const snapshot = (read as Row[]).map((x) => ({ ...x }));
      store.set(r.id, { ...store.get(r.id)!, updatedAt: new Date("2026-10-07T05:41:01Z"), demandInputSource: "human", impact: 3 });
      return snapshot;
    };
    const result = await runDemandScoringSteward(db, { ...base, batchSize: 1 });
    expect(result.scored).toEqual([]);
    expect(result.raced).toEqual(["BI-RACE"]);
    expect(store.get(r.id)!.impact).toBe(3);
    expect(store.get(r.id)!.demandInputSource).toBe("human");
  });

  it("leaves an item with no effort signal for a person and says so", async () => {
    const { db } = fakeDb([row({ itemId: "BI-NOSIZE", effortSize: null })]);
    const result = await runDemandScoringSteward(db, { ...base, batchSize: 5 });
    expect(result.scored).toEqual([]);
    expect(result.noEffortSignal).toEqual(["BI-NOSIZE"]);
  });

  it("raises the scored count run over run until the pool is drained (AC-3)", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ itemId: `BI-${i}` }));
    const { db } = fakeDb(rows);
    const first = await runDemandScoringSteward(db, { ...base, batchSize: 2 });
    const second = await runDemandScoringSteward(db, { ...base, batchSize: 2 });
    const third = await runDemandScoringSteward(db, { ...base, batchSize: 2 });
    expect([first.scored.length, second.scored.length, third.scored.length]).toEqual([2, 2, 1]);
    expect([first.unscoredRemaining, second.unscoredRemaining, third.unscoredRemaining]).toEqual([3, 1, 0]);
    expect(new Set([...first.scored, ...second.scored, ...third.scored]).size).toBe(5);
  });

  it("calls onScored for each item it wrote, and an onScored failure never fails the run", async () => {
    const { db } = fakeDb([row({ itemId: "BI-A" }), row({ itemId: "BI-B" })]);
    const seen: string[] = [];
    const result = await runDemandScoringSteward(db, {
      ...base,
      batchSize: 5,
      onScored: async (itemId) => {
        seen.push(itemId);
        throw new Error("refresh down");
      },
    });
    expect(result.scored.sort()).toEqual(["BI-A", "BI-B"]);
    expect(seen.sort()).toEqual(["BI-A", "BI-B"]);
  });
});

describe("resolveStewardBatchSize", () => {
  it("defaults, honours taskConfig.batchSize, and clamps", () => {
    expect(resolveStewardBatchSize(null)).toBe(DEFAULT_STEWARD_BATCH_SIZE);
    expect(resolveStewardBatchSize({ batchSize: 10 })).toBe(10);
    expect(resolveStewardBatchSize({ batchSize: 0 })).toBe(DEFAULT_STEWARD_BATCH_SIZE);
    expect(resolveStewardBatchSize({ batchSize: "x" })).toBe(DEFAULT_STEWARD_BATCH_SIZE);
    expect(resolveStewardBatchSize({ batchSize: 10_000 })).toBe(MAX_STEWARD_BATCH_SIZE);
    expect(resolveStewardBatchSize({ batchSize: 7.9 })).toBe(7);
  });
});
