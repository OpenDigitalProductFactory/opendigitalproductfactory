import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-5BF1D4D0 — the hygiene sweep that resolves escalations also brings back the
// items those escalations parked, and reports the orphan invariant.

const reconcile = vi.fn();
const countOrphans = vi.fn();

vi.mock("@dpf/db", () => ({
  Prisma: { DbNull: "DbNull" },
  prisma: {
    platformIssueReport: { findMany: vi.fn(async () => []), update: vi.fn() },
    backlogItem: { findMany: vi.fn(async () => []) },
    decisionInteraction: { findMany: vi.fn(async () => []), update: vi.fn() },
  },
}));
vi.mock("@/lib/backlog/escalation-parked-return", () => ({
  reconcileEscalationParkedItems: (...args: unknown[]) => reconcile(...args),
  countEscalationParkedOrphans: (...args: unknown[]) => countOrphans(...args),
}));

import { runEscalationHygiene } from "./escalation-hygiene-runner";

describe("runEscalationHygiene — parked item return (BI-5BF1D4D0)", () => {
  beforeEach(() => {
    reconcile.mockReset();
    countOrphans.mockReset();
  });

  it("re-evaluates parked items and reports a zero orphan invariant", async () => {
    reconcile.mockResolvedValue({ scanned: 3, reopened: 2, redeferred: 1, unrouted: 0 });
    countOrphans.mockResolvedValue(0);

    const result = await runEscalationHygiene();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      parkedItemsReopened: 2,
      parkedItemsRedeferred: 1,
      parkedOrphansRemaining: 0,
    });
  });

  it("surfaces a violated invariant instead of hiding it", async () => {
    reconcile.mockResolvedValue({ scanned: 1, reopened: 0, redeferred: 0, unrouted: 1 });
    countOrphans.mockResolvedValue(1);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runEscalationHygiene();

    expect(result.parkedOrphansRemaining).toBe(1);
    expect(errors.mock.calls.flat().join(" ")).toContain("INVARIANT VIOLATION (BI-5BF1D4D0)");
    errors.mockRestore();
  });

  it("never fails the sweep when the re-evaluation throws", async () => {
    reconcile.mockRejectedValue(new Error("db down"));
    countOrphans.mockRejectedValue(new Error("db down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runEscalationHygiene();

    expect(result).toMatchObject({ parkedItemsReopened: 0, parkedOrphansRemaining: null });
    errors.mockRestore();
  });
});
