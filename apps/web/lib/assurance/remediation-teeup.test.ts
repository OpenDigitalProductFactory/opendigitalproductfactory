import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ASSURANCE_REMEDIATION_BUDGET,
  isAssuranceRemediationWindowOpen,
  resolveRemediationBudget,
  runAssuranceRemediationTeeUp,
  selectAssuranceRemediationCandidates,
  type RemediationCandidate,
} from "./remediation-teeup";

function candidate(overrides: Partial<RemediationCandidate> = {}): RemediationCandidate {
  return {
    id: "cuid-1",
    itemId: "BI-1",
    title: "Remediate: hono X",
    body: "Severity: HIGH\n\n[origin:assuranceFinding:fk-1]",
    status: "triaging",
    proposedOutcome: "build",
    activeBuildId: null,
    effortSize: "medium",
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    ...overrides,
  };
}

describe("selectAssuranceRemediationCandidates", () => {
  it("keeps only triaging, build-proposed, unbuilt, assurance-origin items", () => {
    const items = [
      candidate({ itemId: "ok" }),
      candidate({ itemId: "not-triaging", status: "open" }),
      candidate({ itemId: "not-build", proposedOutcome: "defer" }),
      candidate({ itemId: "has-build", activeBuildId: "fb-1" }),
      candidate({ itemId: "not-assurance", body: "Severity: HIGH\n\nsome other BI" }),
      candidate({ itemId: "null-body", body: null }),
    ];
    const got = selectAssuranceRemediationCandidates(items, 10).map((c) => c.itemId);
    expect(got).toEqual(["ok"]);
  });

  it("orders critical before high, then oldest first", () => {
    const items = [
      candidate({ itemId: "high-old", body: "Severity: HIGH [origin:assuranceFinding:a]", createdAt: new Date("2026-06-20T00:00:00Z") }),
      candidate({ itemId: "crit-new", body: "Severity: CRITICAL [origin:assuranceFinding:b]", createdAt: new Date("2026-06-22T00:00:00Z") }),
      candidate({ itemId: "crit-old", body: "Severity: CRITICAL [origin:assuranceFinding:c]", createdAt: new Date("2026-06-21T00:00:00Z") }),
    ];
    expect(selectAssuranceRemediationCandidates(items, 10).map((c) => c.itemId)).toEqual([
      "crit-old",
      "crit-new",
      "high-old",
    ]);
  });

  it("caps at the budget", () => {
    const items = [candidate({ itemId: "a" }), candidate({ itemId: "b" }), candidate({ itemId: "c" })];
    expect(selectAssuranceRemediationCandidates(items, 2)).toHaveLength(2);
  });

  it("returns nothing for a zero/negative budget", () => {
    expect(selectAssuranceRemediationCandidates([candidate()], 0)).toEqual([]);
    expect(selectAssuranceRemediationCandidates([candidate()], -1)).toEqual([]);
  });
});

describe("isAssuranceRemediationWindowOpen", () => {
  it("is open inside the 02:00–06:00 UTC window", () => {
    expect(isAssuranceRemediationWindowOpen(new Date("2026-06-23T03:00:00Z"))).toBe(true);
    expect(isAssuranceRemediationWindowOpen(new Date("2026-06-23T05:59:00Z"))).toBe(true);
  });

  it("is closed outside the window", () => {
    expect(isAssuranceRemediationWindowOpen(new Date("2026-06-23T12:00:00Z"))).toBe(false);
    expect(isAssuranceRemediationWindowOpen(new Date("2026-06-23T06:00:00Z"))).toBe(false);
  });
});

describe("resolveRemediationBudget", () => {
  it("defaults when unset or invalid", () => {
    expect(resolveRemediationBudget({})).toBe(DEFAULT_ASSURANCE_REMEDIATION_BUDGET);
    expect(resolveRemediationBudget({ ASSURANCE_REMEDIATION_BUDGET: "abc" })).toBe(DEFAULT_ASSURANCE_REMEDIATION_BUDGET);
  });

  it("honors a valid env override (including 0)", () => {
    expect(resolveRemediationBudget({ ASSURANCE_REMEDIATION_BUDGET: "5" })).toBe(5);
    expect(resolveRemediationBudget({ ASSURANCE_REMEDIATION_BUDGET: "0" })).toBe(0);
  });
});

describe("runAssuranceRemediationTeeUp", () => {
  function prismaWith(items: RemediationCandidate[], governed: boolean) {
    return {
      platformDevConfig: { findUnique: vi.fn(async () => ({ governedBacklogEnabled: governed })) },
      backlogItem: { findMany: vi.fn(async () => items) },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
    };
  }

  it("does nothing when governed backlog is disabled", async () => {
    const prisma = prismaWith([candidate()], false);
    const promote = vi.fn();
    const result = await runAssuranceRemediationTeeUp({ prisma: prisma as never, userId: "u1", budget: 5, promote });
    expect(result.enabled).toBe(false);
    expect(promote).not.toHaveBeenCalled();
  });

  it("promotes a budgeted batch and returns counts", async () => {
    const prisma = prismaWith(
      [candidate({ itemId: "a" }), candidate({ itemId: "b" }), candidate({ itemId: "c" })],
      true,
    );
    let n = 0;
    const promote = vi.fn(async ({ itemId }: { prisma: unknown; itemId: string; userId: string }) => ({
      kind: "success" as const,
      build: { id: `cuid-${++n}`, buildId: `FB-${itemId}` },
      backlogItemId: itemId,
      capsuleId: `WC-${itemId}`,
      autoApprovedDispatchEligible: true,
    }));

    const result = await runAssuranceRemediationTeeUp({ prisma: prisma as never, userId: "u1", budget: 2, promote });

    expect(result.enabled).toBe(true);
    expect(result.selectedCount).toBe(2);
    expect(result.promotedCount).toBe(2);
    expect(result.builds).toEqual([
      { backlogItemId: "a", buildId: "FB-a" },
      { backlogItemId: "b", buildId: "FB-b" },
    ]);
    expect(promote).toHaveBeenCalledTimes(2);
  });

  it("counts promote failures as skipped", async () => {
    const prisma = prismaWith([candidate({ itemId: "a" })], true);
    const promote = vi.fn(async () => ({ kind: "error" as const, error: "x", message: "nope" }));
    const result = await runAssuranceRemediationTeeUp({ prisma: prisma as never, userId: "u1", budget: 5, promote });
    expect(result.promotedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });
});
