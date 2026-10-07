import { describe, expect, it, vi } from "vitest";

import type { OwedAcceptance } from "./owed-acceptance";
import { recordOwedAcceptanceSnapshot, type OwedSnapshotDb } from "./owed-snapshot";
import type { AcceptancePoolAge } from "./acceptance-pool-age";
import type { AcceptanceSweepPageItem } from "./acceptance-sweep-page";
import { runAcceptanceSweep, type AcceptanceSweepPorts, type AcceptanceSweepSummary } from "./acceptance-sweep-run";

// AC-S2-2 and AC-S2-3 (BI-DF255666; design §3.3, plan phase 2): one run
// evaluates at most the page, records a snapshot only for items whose
// projection changed, and writes one summary with the pool's age bands, the
// over-30-day count, closable, unroutable by code and the created-basis count.

const NOW = new Date("2026-10-06T05:00:00.000Z");
const CONFIG = { pageSize: 3, agedDays: 14, trendDays: 30, routing: false, recordedByAgentId: "AGT-WS-PORTFOLIO" } as const;

function item(id: string): AcceptanceSweepPageItem {
  return { id, itemId: `BI-${id.toUpperCase()}`, claimedByAgentId: null, agentId: null };
}

function age(id: string, ageDays: number, ageBasis: "entry" | "created" = "entry"): AcceptancePoolAge {
  return { rowId: id, itemId: `BI-${id.toUpperCase()}`, enteredAt: new Date(NOW.getTime() - ageDays * 86_400_000), ageBasis, ageDays };
}

const owned: OwedAcceptance = {
  owed: [{ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer", nextAction: "map" }],
  owner: { agentId: "AGT-WS-ACCEPT", displayName: "Acceptance", codes: ["ACCEPTANCE_EVIDENCE_REQUIRED"] },
  unroutable: [],
  closable: false,
};
const unroutable: OwedAcceptance = {
  owed: [
    { code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer", nextAction: null },
    { code: "DELIVERY_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator", nextAction: null },
  ],
  owner: null,
  unroutable: [
    { code: "ACCEPTANCE_EVIDENCE_REQUIRED", accountableRole: "acceptance-reviewer", reason: "workroom-not-found", nextAction: null },
    { code: "DELIVERY_EVIDENCE_REQUIRED", accountableRole: "delivery-coordinator", reason: "no-writer-lane", nextAction: null },
  ],
  closable: false,
};
const closable: OwedAcceptance = { owed: [], owner: null, unroutable: [], closable: true };

/** An in-memory activity store driven through S1's real snapshot writer. */
function snapshotStore() {
  const rows: Array<{ id: string; backlogItemId: string; payload: Record<string, unknown> }> = [];
  const db: OwedSnapshotDb = {
    backlogItemActivity: {
      findFirst: async ({ where }) => [...rows].reverse().find((row) => row.backlogItemId === where.backlogItemId) ?? null,
      create: async ({ data }) => {
        const id = `act-${rows.length + 1}`;
        rows.push({ id, backlogItemId: data.backlogItemId, payload: data.payload });
        return { id };
      },
    },
  };
  return { rows, db };
}

function ports(overrides: Partial<AcceptanceSweepPorts> = {}) {
  const store = snapshotStore();
  const runs: AcceptanceSweepSummary[] = [];
  const projections: Record<string, OwedAcceptance | null> = { a: owned, b: unroutable, c: closable };
  const base: AcceptanceSweepPorts = {
    now: NOW,
    loadPoolAges: async () => new Map([
      ["a", age("a", 3)],
      ["b", age("b", 20)],
      ["c", age("c", 45, "created")],
      ["d", age("d", 31)],
    ]),
    loadLastCursor: async () => "z",
    selectPage: vi.fn(async () => ({ items: [item("a"), item("b"), item("c")], unsnapshotted: 1, nextCursor: "c" })),
    evaluate: vi.fn(async (entry: AcceptanceSweepPageItem) => projections[entry.id] ?? null),
    recordSnapshot: (entry, projection) => recordOwedAcceptanceSnapshot({
      db: store.db,
      backlogItemId: entry.id,
      projection,
      recordedByAgentId: CONFIG.recordedByAgentId,
    }),
    recordRun: vi.fn(async (summary: AcceptanceSweepSummary) => {
      runs.push(summary);
      return { activityId: `run-${runs.length}` };
    }),
    // BI-45D3BBF4: closing is off unless an operator pre-authorisation is recorded.
    resolveCloseAuthorisation: async () => ({ state: "disabled", reason: "not-recorded", because: "none recorded" }),
    close: vi.fn(async () => { throw new Error("close must not be called while closing is off"); }),
    ...overrides,
  };
  return { ports: base, store, runs };
}

describe("runAcceptanceSweep", () => {
  it("continues from the previous run's cursor and evaluates at most the page", async () => {
    const { ports: p } = ports();
    await runAcceptanceSweep(p, CONFIG);
    expect(p.selectPage).toHaveBeenCalledWith({ pageSize: 3, cursor: "z" });
    expect(p.evaluate).toHaveBeenCalledTimes(3);
  });

  it("refuses to evaluate more than the page even if the selector over-delivers", async () => {
    const { ports: p } = ports({
      selectPage: vi.fn(async () => ({ items: [item("a"), item("b"), item("c"), item("d")], unsnapshotted: 0, nextCursor: "d" })),
    });
    await runAcceptanceSweep(p, CONFIG);
    expect(p.evaluate).toHaveBeenCalledTimes(3);
  });

  it("writes one snapshot per changed item and none on an unchanged re-run", async () => {
    const { ports: p, store, runs } = ports();
    await runAcceptanceSweep(p, CONFIG);
    expect(store.rows.map((row) => row.backlogItemId)).toEqual(["a", "b", "c"]);
    expect(runs[0]!.page.snapshotsWritten).toBe(3);

    await runAcceptanceSweep(p, CONFIG);
    expect(store.rows).toHaveLength(3);
    expect(runs[1]!.page.snapshotsWritten).toBe(0);
  });

  it("writes one run summary with pool age, the over-30 trend, closable, owned and unroutable by code", async () => {
    const { ports: p, runs } = ports();
    const summary = await runAcceptanceSweep(p, CONFIG);

    expect(p.recordRun).toHaveBeenCalledTimes(1);
    expect(runs[0]).toBe(summary);
    expect(summary.pool).toEqual({
      size: 4,
      ageBands: { "under-7d": 1, "7-14d": 0, "14-30d": 1, "over-30d": 2 },
      aged: 3,
      agedOverTrend: 2,
      trendDays: 30,
      ageBasisCreated: 1,
      oldestAgeDays: 45,
    });
    expect(summary.page).toEqual({
      pageSize: 3,
      evaluated: 3,
      unsnapshotted: 1,
      snapshotsWritten: 3,
      readinessUnavailable: 0,
      closable: 1,
      owned: 1,
      unroutableItems: 1,
      unroutableByCode: { ACCEPTANCE_EVIDENCE_REQUIRED: 1, DELIVERY_EVIDENCE_REQUIRED: 1 },
      unroutableByReason: { "workroom-not-found": 1, "no-writer-lane": 1 },
      ageBasisCreated: 1,
      aged: 2,
      agedOverTrend: 1,
    });
    expect(summary.items).toEqual({
      closable: ["BI-C"],
      aged: ["BI-B", "BI-C"],
      unroutable: ["BI-B"],
      readinessUnavailable: [],
    });
    expect(summary.revisit).toEqual({ poolSize: 4, pageSize: 3, runsPerRevisit: 2, exceedsTrendWindow: false });
    expect(summary.routing).toEqual({ enabled: false, routed: 0 });
    expect(summary.cursor).toBe("c");
    expect(summary.ranAt).toBe(NOW.toISOString());
    expect(summary.headline).toContain("4 awaiting acceptance");
    expect(summary.headline).toContain("2 over 30 days");
  });

  it("reports an item whose readiness could not be computed and keeps going", async () => {
    const { ports: p, store } = ports({
      evaluate: vi.fn(async (entry: AcceptanceSweepPageItem) => {
        if (entry.id === "a") throw new Error("readiness down");
        return entry.id === "b" ? null : closable;
      }),
    });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(summary.page.readinessUnavailable).toBe(2);
    expect(summary.items.readinessUnavailable).toEqual(["BI-A", "BI-B"]);
    expect(store.rows.map((row) => row.backlogItemId)).toEqual(["c"]);
  });

  it("states when the revisit period exceeds the trend window", async () => {
    const big = new Map(Array.from({ length: 100 }, (_, index) => [`r${index}`, age(`r${index}`, 1)]));
    const { ports: p } = ports({ loadPoolAges: async () => big });
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(summary.revisit).toEqual({ poolSize: 100, pageSize: 3, runsPerRevisit: 34, exceedsTrendWindow: true });
  });

  it("closes nothing and says why when no pre-authorisation is recorded", async () => {
    const { ports: p } = ports();
    const summary = await runAcceptanceSweep(p, CONFIG);
    expect(p.close).not.toHaveBeenCalled();
    expect(summary.closing).toMatchObject({ enabled: false, disabledReason: "not-recorded", closed: [] });
    expect(summary.headline).toContain("closing off (not-recorded)");
  });

  it("never routes while routing is off", async () => {
    const { ports: p } = ports();
    const summary = await runAcceptanceSweep(p, { ...CONFIG, routing: false });
    expect(summary.routing.routed).toBe(0);
  });
});
