import { describe, expect, it } from "vitest";

import {
  acknowledgeSweep,
  claimSweep,
  emptySweepCheckpoint,
  observeUpgrade,
  readSweepCheckpoint,
  requireSweepOwner,
} from "./acceptance-sweep-checkpoint";

const now = Date.parse("2026-10-12T18:00:00Z");
const first = { runId: "SUR-FIRST", completedAt: "2026-10-12T17:00:00.000Z", rowId: "row-first" };
const rollback = { runId: "SUR-ROLLBACK", completedAt: "2026-10-12T18:00:00.000Z", rowId: "row-rollback" };

describe("acceptance sweep checkpoint", () => {
  it("retains a wakeup arriving while an older generation is running", () => {
    const pending = observeUpgrade(emptySweepCheckpoint(), first);
    const claimed = claimSweep(pending, "owner-a", now);
    const newer = observeUpgrade(claimed.checkpoint, rollback);
    const settled = acknowledgeSweep(newer, claimed.claim, now + 1);
    expect(settled.pending).toEqual(rollback);
    expect(settled.acknowledgedRunId).toBe(first.runId);
    expect(settled.owner).toBeNull();
  });

  it("coalesces duplicate and delayed upgrade notices, including rollback runs", () => {
    const newer = observeUpgrade(observeUpgrade(emptySweepCheckpoint(), first), rollback);
    expect(observeUpgrade(newer, first)).toEqual(newer);
    expect(observeUpgrade(newer, rollback)).toEqual(newer);
  });

  it("does not readmit an acknowledged upgrade", () => {
    const claimed = claimSweep(observeUpgrade(emptySweepCheckpoint(), first), "owner-a", now);
    const settled = acknowledgeSweep(claimed.checkpoint, claimed.claim, now + 1);
    expect(observeUpgrade(settled, first).pending).toBeNull();
  });

  it("refuses simultaneous owners and rejects A after expiry and B takeover", () => {
    const a = claimSweep(emptySweepCheckpoint(), "owner-a", now);
    expect(() => claimSweep(a.checkpoint, "owner-b", now + 1)).toThrow("already owned");
    const b = claimSweep(a.checkpoint, "owner-b", now + 300_000);
    expect(() => requireSweepOwner(b.checkpoint, a.claim, now + 300_001)).toThrow("ownership lost");
    expect(() => acknowledgeSweep(b.checkpoint, a.claim, now + 300_001)).toThrow("ownership lost");
    expect(() => requireSweepOwner(b.checkpoint, b.claim, now + 300_001)).not.toThrow();
  });

  it("refuses an expired owner even before a successor claims", () => {
    const a = claimSweep(emptySweepCheckpoint(), "owner-a", now);
    expect(() => requireSweepOwner(a.checkpoint, a.claim, now + 300_000)).toThrow("ownership lost");
  });

  it("does not let a cadence run acknowledge a later upgrade", () => {
    const daily = claimSweep(emptySweepCheckpoint(), "owner-daily", now);
    const pending = observeUpgrade(daily.checkpoint, first);
    const settled = acknowledgeSweep(pending, daily.claim, now + 1);
    expect(settled.pending).toEqual(first);
    expect(settled.acknowledgedRunId).toBeNull();
  });

  it("fails closed on malformed persisted ownership instead of resetting it", () => {
    expect(readSweepCheckpoint({ otherConfig: true })).toEqual(emptySweepCheckpoint());
    expect(() => readSweepCheckpoint({ acceptanceSweep: { schemaVersion: 1 } })).toThrow("Malformed acceptance sweep checkpoint");
    expect(() => readSweepCheckpoint({ acceptanceSweep: { ...emptySweepCheckpoint(), owner: { token: "x" } } })).toThrow();
  });
});
