import { describe, expect, it } from "vitest";
import {
  readyToSwapBudgetMs,
  resolveConfirmedUpgradeWindow,
  remainingReadyToSwapMs,
  isReadyToSwapWindowLive,
} from "./ready-to-swap-window";

const minute = 60_000;
const readyAt = new Date("2026-11-25T14:00:00Z");

describe("ready-to-swap window", () => {
  it("keeps operation bounds separate and does not extend legacy requests", () => {
    expect(readyToSwapBudgetMs("paired-upgrade", 25 * minute)).toBe(125 * minute);
    expect(readyToSwapBudgetMs("paired-volume-teardown", 25 * minute)).toBe(160 * minute);
    expect(readyToSwapBudgetMs("unrelated", 25 * minute)).toBe(35 * minute);
    expect(resolveConfirmedUpgradeWindow(undefined, 25 * minute)).toBe(35 * minute);
    expect(resolveConfirmedUpgradeWindow(125 * minute, 25 * minute)).toBe(125 * minute);
    expect(() => resolveConfirmedUpgradeWindow(125 * minute, 26 * minute)).toThrow(/review/i);
  });

  it("honors a confirmed slow recovery, then expires at exactly the same instant irrespective of heartbeats", () => {
    const deadline = new Date(+readyAt + 125 * minute);
    expect(remainingReadyToSwapMs(deadline, new Date(+readyAt + 93 * minute))).toBe(32 * minute);
    const run = { status: "ready-to-swap", abortRequestedAt: null, readyToSwapDeadlineAt: deadline, enteredStateAt: {} };
    expect(isReadyToSwapWindowLive(run, new Date(+deadline - 1))).toBe(true);
    expect(isReadyToSwapWindowLive(run, deadline)).toBe(false);
    expect(isReadyToSwapWindowLive({ ...run, abortRequestedAt: readyAt }, readyAt)).toBe(false);
    expect(isReadyToSwapWindowLive({ ...run, status: "failed" }, readyAt)).toBe(false);
  });

  it("leaves a bounded handoff after slow capture and trial only for paired-volume mode", () => {
    const trialFinished = new Date(+readyAt + 150 * minute);
    const expires = (kind: Parameters<typeof readyToSwapBudgetMs>[0]) => new Date(+readyAt + readyToSwapBudgetMs(kind, 25 * minute));
    expect(remainingReadyToSwapMs(expires("paired-volume-teardown"), trialFinished)).toBe(10 * minute);
    expect(remainingReadyToSwapMs(expires("paired-upgrade"), trialFinished)).toBe(0);
    expect(remainingReadyToSwapMs(expires("unrelated"), trialFinished)).toBe(0);
  });
});
