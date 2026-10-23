// The writeback latch reads what the dispatched run actually did (BI-7C0B2BD6).
//
// Live on 2026-10-14: 279 rooms paused on executor_writeback_unavailable. The
// latch held whenever the prior tick had dispatched, so it held for rooms where
// no task was ever created and for rooms whose run had already failed. It now
// holds only while a run is genuinely outstanding; a failed run is retried with
// backoff, and after WRITEBACK_RETRY_LIMIT failures in a cycle the room stays
// paused and names the last error.

import { describe, expect, it } from "vitest";

import {
  WRITEBACK_RETRY_BASE_MS,
  WRITEBACK_RETRY_LIMIT,
  WRITEBACK_RUN_DEADLINE_MS,
  decideWritebackLatch,
  type StageRunObservation,
  type WritebackRetry,
} from "./writeback-latch";

const CYCLE = "delivery-small@1.0.0:2026-10-14";
const NEXT_CYCLE = "delivery-small@1.0.0:2026-10-15";
const DISPATCHED = "2026-10-14T01:00:00.000Z";
const at = (iso: string) => new Date(iso);
const latched = { action: "pause", reason: "executor_writeback_unavailable", stageKey: "implement", cycleKey: CYCLE };
const dispatchedPrior = { action: "dispatch_agent", reason: "agent_stage", stageKey: "implement", cycleKey: CYCLE };

function run(over: Partial<StageRunObservation> = {}): StageRunObservation {
  return { stageKey: "implement", dispatchedAt: DISPATCHED, lastRunAt: null, lastStatus: null, lastError: null, ...over };
}

function decide(over: Partial<Parameters<typeof decideWritebackLatch>[0]> = {}) {
  return decideWritebackLatch({
    prior: latched, stageKey: "implement", currentCycleKey: CYCLE, blocked: true,
    run: run(), retry: null, now: at("2026-10-14T01:15:00.000Z"), ...over,
  });
}

describe("decideWritebackLatch (BI-7C0B2BD6)", () => {
  it("releases when no task exists for the stage", () => {
    // The old dispatch_agent/missing_task_owner rooms: nothing was ever queued.
    expect(decide({ run: null, prior: dispatchedPrior, blocked: false })).toMatchObject({ hold: false });
  });

  it("releases when the room's task is configured for a different stage", () => {
    expect(decide({ run: run({ stageKey: "spec" }) })).toMatchObject({ hold: false });
  });

  it("releases when the drive never recorded queuing the task", () => {
    expect(decide({ run: run({ dispatchedAt: null }) })).toMatchObject({ hold: false });
  });

  it("holds while the dispatched run is outstanding, and keeps the task active", () => {
    expect(decide()).toMatchObject({ hold: true, why: "outstanding", keepTaskActive: true });
  });

  it("an earlier run that predates the dispatch is still outstanding", () => {
    const decision = decide({ run: run({ lastRunAt: "2026-10-13T20:00:00.000Z", lastStatus: "error", lastError: "old" }) });
    expect(decision).toMatchObject({ hold: true, why: "outstanding" });
  });

  it("an outstanding run past the deadline counts as a failure and releases", () => {
    const now = new Date(Date.parse(DISPATCHED) + WRITEBACK_RUN_DEADLINE_MS + 1);
    const decision = decide({ now });
    expect(decision.hold).toBe(false);
    expect(decision.retry).toMatchObject({ stageKey: "implement", cycleKey: CYCLE, failures: 1 });
    expect(decision.retry?.lastError).toMatch(/no run finished/i);
  });

  it("a run that ended in error since dispatch is retried after backoff", () => {
    const failed = run({ lastRunAt: "2026-10-14T01:10:00.000Z", lastStatus: "error", lastError: "No AI provider could take this turn" });
    const early = decide({ run: failed, now: at("2026-10-14T01:15:00.000Z") });
    expect(early).toMatchObject({ hold: true, why: "backoff" });
    expect(early.retry).toMatchObject({ failures: 1, lastError: "No AI provider could take this turn" });
    const later = decide({ run: failed, retry: early.retry, now: new Date(Date.parse("2026-10-14T01:10:00.000Z") + WRITEBACK_RETRY_BASE_MS) });
    expect(later).toMatchObject({ hold: false });
    // The same run is counted once, however many ticks read it.
    expect(later.retry?.failures).toBe(1);
  });

  it("a run that finished ok without a completing receipt is a failure too", () => {
    const decision = decide({ run: run({ lastRunAt: "2026-10-14T01:10:00.000Z", lastStatus: "ok" }) });
    expect(decision.retry?.failures).toBe(1);
    expect(decision.retry?.lastError).toMatch(/without recording/i);
  });

  it("backoff doubles with each failure", () => {
    const prior: WritebackRetry = { stageKey: "implement", cycleKey: CYCLE, failures: 1, lastError: "x", lastFailedAt: "2026-10-14T01:10:00.000Z", countedRunAt: "2026-10-14T01:10:00.000Z" };
    const failed = run({ dispatchedAt: "2026-10-14T01:30:00.000Z", lastRunAt: "2026-10-14T01:40:00.000Z", lastStatus: "error", lastError: "y" });
    const once = decide({ run: failed, retry: prior, now: new Date(Date.parse("2026-10-14T01:40:00.000Z") + WRITEBACK_RETRY_BASE_MS) });
    expect(once).toMatchObject({ hold: true, why: "backoff" });
    expect(once.retry?.failures).toBe(2);
    const twice = decide({ run: failed, retry: once.retry, now: new Date(Date.parse("2026-10-14T01:40:00.000Z") + 2 * WRITEBACK_RETRY_BASE_MS) });
    expect(twice).toMatchObject({ hold: false });
  });

  it(`after ${WRITEBACK_RETRY_LIMIT} failures of the same stage in a cycle the room stays paused and names the last error`, () => {
    const prior: WritebackRetry = { stageKey: "implement", cycleKey: CYCLE, failures: WRITEBACK_RETRY_LIMIT - 1, lastError: "x", lastFailedAt: "2026-10-14T01:00:00.000Z", countedRunAt: "2026-10-14T01:00:00.000Z" };
    const failed = run({ dispatchedAt: "2026-10-14T02:00:00.000Z", lastRunAt: "2026-10-14T02:10:00.000Z", lastStatus: "error", lastError: "produced no governed work" });
    const decision = decide({ run: failed, retry: prior, now: at("2026-10-14T09:00:00.000Z") });
    expect(decision).toMatchObject({ hold: true, why: "exhausted" });
    expect(decision.retry).toMatchObject({ failures: WRITEBACK_RETRY_LIMIT, lastError: "produced no governed work" });
  });

  it("a new cycle resets the failure count, so a deployed fix still reaches the room", () => {
    const exhausted: WritebackRetry = { stageKey: "implement", cycleKey: CYCLE, failures: WRITEBACK_RETRY_LIMIT, lastError: "x", lastFailedAt: "2026-10-14T02:10:00.000Z", countedRunAt: "2026-10-14T02:10:00.000Z" };
    const failed = run({ dispatchedAt: "2026-10-14T02:00:00.000Z", lastRunAt: "2026-10-14T02:10:00.000Z", lastStatus: "error", lastError: "x" });
    const decision = decide({ run: failed, retry: exhausted, currentCycleKey: NEXT_CYCLE, now: at("2026-10-15T00:15:00.000Z") });
    expect(decision.hold).toBe(false);
    expect(decision.retry).toMatchObject({ cycleKey: NEXT_CYCLE, failures: 1 });
  });

  it("does not latch a stage that was never tried", () => {
    expect(decide({ prior: { ...dispatchedPrior, stageKey: "spec" }, blocked: false })).toMatchObject({ hold: false });
  });

  it("without a run observation keeps the cycle-bounded rule exactly", () => {
    expect(decide({ run: undefined })).toMatchObject({ hold: true, why: "cycle" });
    expect(decide({ run: undefined, currentCycleKey: NEXT_CYCLE })).toMatchObject({ hold: false });
  });
});
