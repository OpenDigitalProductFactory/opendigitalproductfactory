import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {},
  ACCEPTANCE_AGED_DAYS: 14,
  ACCEPTANCE_SWEEP_AGENT_ID: "AGT-WS-PORTFOLIO",
  ACCEPTANCE_SWEEP_PAGE_SIZE: 100,
  ACCEPTANCE_SWEEP_ROUTE_LIMIT: 10,
  ACCEPTANCE_SWEEP_ROUTING: true,
  ACCEPTANCE_TREND_DAYS: 30,
}));

import { computeNextCronRun } from "@/lib/operate/cron-next-run";

import type { AcceptanceSweepSummary } from "./acceptance-sweep-run";
import { emptyRouting } from "./acceptance-sweep-routing";
import {
  ACCEPTANCE_ROOM_KEY,
  ACCEPTANCE_SWEEP_RUN_ACTIVITY_KIND,
  executeAcceptanceSweepTask,
  loadLastSweepCursor,
  recordSweepRun,
} from "./acceptance-sweep-task";

// AC-S2-1 and AC-S2-3 (BI-DF255666; plan phase 2): the executor runs with no
// model call, writes its summary to the standing Acceptance steward room
// (upserted on a stable key, the concierge-sweep pattern), carries the cursor
// for the next run, and records lastRunAt / nextRunAt like the decision review.

const NOW = new Date("2026-10-06T05:00:12.000Z");
const TASK = { taskId: "acceptance-sweep-daily", schedule: "0 5 * * *", agentId: "AGT-WS-PORTFOLIO" };
// The scheduler's own cron helper (it evaluates in the process time zone, UTC in the container).
const NEXT_RUN_AT = computeNextCronRun(TASK.schedule, NOW);

function summary(overrides: Partial<AcceptanceSweepSummary> = {}): AcceptanceSweepSummary {
  return {
    schemaVersion: 1,
    ranAt: NOW.toISOString(),
    headline: "Acceptance sweep: 2 awaiting acceptance",
    pool: { size: 2, ageBands: { "under-7d": 1, "7-14d": 0, "14-30d": 0, "over-30d": 1 }, aged: 1, agedOverTrend: 1, trendDays: 30, ageBasisCreated: 1, oldestAgeDays: 40 },
    page: {
      pageSize: 100, evaluated: 2, unsnapshotted: 2, snapshotsWritten: 2, readinessUnavailable: 0, closable: 0, owned: 1,
      unroutableItems: 1, unroutableByCode: { ACCEPTANCE_EVIDENCE_REQUIRED: 1 }, unroutableByReason: { "workroom-not-found": 1 },
      ageBasisCreated: 1, aged: 1, agedOverTrend: 1,
    },
    items: { closable: [], aged: ["BI-B"], unroutable: ["BI-B"], readinessUnavailable: [] },
    revisit: { poolSize: 2, pageSize: 100, runsPerRevisit: 1, exceedsTrendWindow: false },
    routing: emptyRouting(false, 0),
    closing: {
      enabled: false, disabledReason: "not-recorded", because: "none recorded", authorisedBy: null, limit: 0,
      attempted: 0, closed: [], refused: [], skipped: [], errored: [], deferredByLimit: [],
    },
    cursor: "row-b",
    ...overrides,
  };
}

function fakeDb() {
  return {
    workroom: {
      findUnique: vi.fn().mockResolvedValue({ id: "room-1" }),
      upsert: vi.fn().mockResolvedValue({ id: "room-1" }),
    },
    workroomActivity: {
      findFirst: vi.fn().mockResolvedValue({ payload: { cursor: "row-a" } }),
      create: vi.fn().mockResolvedValue({ id: "wca-1" }),
    },
    scheduledAgentTask: { update: vi.fn().mockResolvedValue({}) },
    scheduledJob: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe("the standing Acceptance room", () => {
  it("is upserted on a stable key as a scheduled-steward room, bound to no backlog item", async () => {
    const db = fakeDb();
    const result = await recordSweepRun(db, summary(), "AGT-WS-PORTFOLIO");

    expect(result).toEqual({ activityId: "wca-1" });
    const upsert = db.workroom.upsert.mock.calls[0]![0];
    expect(upsert.where).toEqual({ idempotencyKey: ACCEPTANCE_ROOM_KEY });
    expect(upsert.create).toMatchObject({
      idempotencyKey: ACCEPTANCE_ROOM_KEY,
      title: "Acceptance",
      source: "scheduled-steward",
      status: "working",
      executorKind: "dpf-native",
      executorRef: "acceptance-sweep",
    });
    // A steward room verifies work; it never owns an item (design §3.4).
    expect(upsert.create).not.toHaveProperty("backlogItemId");
    expect(db.workroomActivity.create).toHaveBeenCalledWith({
      data: {
        workCapsuleId: "room-1",
        kind: ACCEPTANCE_SWEEP_RUN_ACTIVITY_KIND,
        summary: "Acceptance sweep: 2 awaiting acceptance",
        payload: expect.objectContaining({ cursor: "row-b", pool: expect.objectContaining({ agedOverTrend: 1 }) }),
        recordedByAgentId: "AGT-WS-PORTFOLIO",
      },
      select: { id: true },
    });
  });

  it("hands the next run the previous run's cursor", async () => {
    const db = fakeDb();
    await expect(loadLastSweepCursor(db)).resolves.toBe("row-a");
    expect(db.workroomActivity.findFirst).toHaveBeenCalledWith({
      where: { workCapsuleId: "room-1", kind: ACCEPTANCE_SWEEP_RUN_ACTIVITY_KIND },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: { payload: true },
    });
  });

  it("starts from the beginning when the room or a cursor does not exist yet", async () => {
    const db = fakeDb();
    db.workroom.findUnique.mockResolvedValue(null);
    await expect(loadLastSweepCursor(db)).resolves.toBeNull();
    const second = fakeDb();
    second.workroomActivity.findFirst.mockResolvedValue({ payload: { cursor: 7 } });
    await expect(loadLastSweepCursor(second)).resolves.toBeNull();
  });
});

describe("executeAcceptanceSweepTask", () => {
  it("runs the sweep with the configured bounds and records ok with the next cron time", async () => {
    const db = fakeDb();
    const run = vi.fn().mockResolvedValue(summary());
    await executeAcceptanceSweepTask(TASK, { now: NOW, db: db as never, run });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ now: NOW }), {
      pageSize: 100,
      agedDays: 14,
      trendDays: 30,
      routing: true,
      routeLimit: 10,
      recordedByAgentId: "AGT-WS-PORTFOLIO",
    });
    const nextRunAt = NEXT_RUN_AT;
    expect(nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(db.scheduledAgentTask.update).toHaveBeenCalledWith({
      where: { taskId: "acceptance-sweep-daily" },
      data: { lastRunAt: NOW, lastStatus: "ok", lastError: null, nextRunAt },
    });
    expect(db.scheduledJob.update).toHaveBeenCalledWith({
      where: { jobId: "acceptance-sweep-daily" },
      data: { lastRunAt: NOW, lastStatus: "ok", lastError: null, nextRunAt },
    });
  });

  it("records the error and still re-arms the task when the run throws", async () => {
    const db = fakeDb();
    const run = vi.fn().mockRejectedValue(new Error("pool read failed"));
    await executeAcceptanceSweepTask(TASK, { now: NOW, db: db as never, run });
    expect(db.scheduledAgentTask.update).toHaveBeenCalledWith({
      where: { taskId: "acceptance-sweep-daily" },
      data: { lastRunAt: NOW, lastStatus: "error", lastError: "pool read failed", nextRunAt: NEXT_RUN_AT },
    });
  });
});
