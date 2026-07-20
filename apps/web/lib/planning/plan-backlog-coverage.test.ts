import { describe, expect, it, vi } from "vitest";

import {
  checkBranchPlanBacklogGate,
  checkPlanBacklogCoverage,
  recordPlanBacklogCoverage,
  validatePlanBacklogCoverage,
  type PlanBacklogCoverageDb,
} from "./plan-backlog-coverage";

const fiveSlices = Array.from({ length: 5 }, (_, index) => ({
  key: `slice-${index + 1}`,
  title: `Future slice ${index + 1}`,
  independentlyShippable: true,
  backlogItemId: index === 0 ? "BI-EXISTING-1" : undefined,
  dependsOn: index === 0 ? [] : [`slice-${index}`],
}));

describe("validatePlanBacklogCoverage", () => {
  it("rejects an xlarge umbrella whose five independent future slices are not all live BIs", () => {
    const result = validatePlanBacklogCoverage({
      effortSize: "xlarge",
      decision: "decomposed",
      deliverables: fiveSlices,
      mappedBacklogItems: [{ itemId: "BI-EXISTING-1", status: "open" }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("decomposition-required");
    expect(result.missingDeliverableKeys).toEqual([
      "slice-2",
      "slice-3",
      "slice-4",
      "slice-5",
    ]);
  });

  it("allows a legitimately atomic phased plan with an auditable rationale", () => {
    const result = validatePlanBacklogCoverage({
      effortSize: "xlarge",
      decision: "atomic",
      rationale:
        "The phases share one compatibility boundary and none can create an independently useful outcome.",
      deliverables: [
        {
          key: "phase-1",
          title: "Internal sequencing only",
          independentlyShippable: false,
          dependsOn: [],
        },
      ],
      mappedBacklogItems: [],
    });

    expect(result).toMatchObject({ ok: true, decision: "atomic" });
  });

  it("accepts existing BI mappings without asking for duplicate creation", () => {
    const mapped = fiveSlices.map((slice, index) => ({
      ...slice,
      backlogItemId: `BI-EXISTING-${index + 1}`,
    }));
    const result = validatePlanBacklogCoverage({
      effortSize: "xlarge",
      decision: "decomposed",
      deliverables: mapped,
      mappedBacklogItems: mapped.map((slice) => ({
        itemId: slice.backlogItemId,
        status: "open",
      })),
    });

    expect(result).toMatchObject({
      ok: true,
      decision: "decomposed",
      mappedItemIds: mapped.map((slice) => slice.backlogItemId),
    });
  });

  it("rejects a claimed atomic plan that still names independent work", () => {
    const result = validatePlanBacklogCoverage({
      effortSize: "xlarge",
      decision: "atomic",
      rationale: "These phases should remain together for delivery consistency.",
      deliverables: [
        {
          key: "slice-1",
          title: "Actually independent",
          independentlyShippable: true,
          dependsOn: [],
        },
      ],
      mappedBacklogItems: [],
    });

    expect(result).toMatchObject({ ok: false, code: "atomic-conflicts-with-independent-work" });
  });
});

function fakeDb(): {
  db: PlanBacklogCoverageDb;
  activityCreate: ReturnType<typeof vi.fn>;
} {
  const activityCreate = vi.fn(async () => ({ id: "activity-receipt-1" }));
  return {
    activityCreate,
    db: {
      backlogItem: {
        findUnique: vi.fn(async ({ where }: { where: { itemId: string } }) =>
          where.itemId === "BI-PARENT"
            ? { id: "parent-row", itemId: "BI-PARENT", effortSize: "xlarge" }
            : null,
        ),
        findMany: vi.fn(async () => [
          { itemId: "BI-EXISTING-1", status: "open" },
          { itemId: "BI-EXISTING-2", status: "deferred" },
        ]),
      },
      backlogItemActivity: { create: activityCreate },
    },
  };
}

describe("checkPlanBacklogCoverage", () => {
  it("revalidates a receipt against the live parent and mapped BacklogItems", async () => {
    const { db } = fakeDb();
    db.backlogItemActivity.findUnique = vi.fn(async () => ({
      id: "activity-receipt-1",
      backlogItemId: "parent-row",
      kind: "plan_backlog_coverage",
      payload: {
        planPath: "docs/superpowers/plans/example.md",
        decision: "decomposed",
        deliverables: [
          { key: "slice-1", title: "First", independentlyShippable: true, backlogItemId: "BI-EXISTING-1" },
          { key: "slice-2", title: "Second", independentlyShippable: true, backlogItemId: "BI-EXISTING-2", dependsOn: ["slice-1"] },
        ],
      },
    }));

    await expect(checkPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      receiptId: "activity-receipt-1",
      db,
    })).resolves.toMatchObject({ ok: true, valid: true, decision: "decomposed" });
  });

  it("rejects a receipt for a different plan", async () => {
    const { db } = fakeDb();
    db.backlogItemActivity.findUnique = vi.fn(async () => ({
      id: "activity-receipt-1",
      backlogItemId: "parent-row",
      kind: "plan_backlog_coverage",
      payload: { planPath: "docs/superpowers/plans/other.md", decision: "atomic", rationale: "A sufficiently detailed atomic rationale.", deliverables: [] },
    }));

    await expect(checkPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      receiptId: "activity-receipt-1",
      db,
    })).resolves.toMatchObject({ ok: false, code: "receipt-plan-mismatch" });
  });

  it("accepts the governed manual-evidence bootstrap receipt used to land the new tool", async () => {
    const { db } = fakeDb();
    db.backlogItemActivity.findUnique = vi.fn(async () => ({
      id: "bootstrap-receipt-1",
      backlogItemId: "parent-row",
      kind: "manual_check",
      payload: {
        body: JSON.stringify({
          bootstrapPlanBacklogCoverage: {
            planPath: "docs/superpowers/plans/example.md",
            decision: "atomic",
            rationale: "The enforcement layers cannot prevent recurrence unless they ship together.",
            deliverables: [],
          },
        }),
      },
    }));

    await expect(checkPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      receiptId: "bootstrap-receipt-1",
      db,
    })).resolves.toMatchObject({ ok: true, valid: true, decision: "atomic" });
  });
});

describe("checkBranchPlanBacklogGate", () => {
  it("requires a coverage decision before source work on a claimed xlarge BI", async () => {
    const result = await checkBranchPlanBacklogGate({
      branchName: "fix/xlarge-plan",
      db: {
        workCapsule: { findFirst: vi.fn(async () => ({ backlogItemId: "BI-PARENT" })) },
        backlogItem: {
          findUnique: vi.fn(async () => ({ id: "parent-row", itemId: "BI-PARENT", effortSize: "xlarge" })),
          findMany: vi.fn(async () => []),
        },
        backlogItemActivity: { findFirst: vi.fn(async () => null) },
      },
    });
    expect(result).toMatchObject({ ok: false, required: true, code: "decomposition-decision-required" });
  });

  it("does not require a hard decision for a claimed non-xlarge BI without a changed plan", async () => {
    const result = await checkBranchPlanBacklogGate({
      branchName: "fix/small-plan",
      db: {
        workCapsule: { findFirst: vi.fn(async () => ({ backlogItemId: "BI-PARENT" })) },
        backlogItem: {
          findUnique: vi.fn(async () => ({ id: "parent-row", itemId: "BI-PARENT", effortSize: "large" })),
          findMany: vi.fn(async () => []),
        },
        backlogItemActivity: { findFirst: vi.fn(async () => null) },
      },
    });
    expect(result).toEqual({ ok: true, required: false, itemId: "BI-PARENT" });
  });
});

describe("recordPlanBacklogCoverage", () => {
  it("records one structured receipt after live BI validation", async () => {
    const { db, activityCreate } = fakeDb();
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      decision: "decomposed",
      deliverables: [
        {
          key: "slice-1",
          title: "First",
          independentlyShippable: true,
          backlogItemId: "BI-EXISTING-1",
          dependsOn: [],
        },
        {
          key: "slice-2",
          title: "Second",
          independentlyShippable: true,
          backlogItemId: "BI-EXISTING-2",
          dependsOn: ["slice-1"],
        },
      ],
      userId: "user-1",
      agentId: "agent-1",
      db,
      now: () => new Date("2026-07-20T03:00:00.000Z"),
    });

    expect(result).toMatchObject({ ok: true, receiptId: "activity-receipt-1" });
    expect(activityCreate).toHaveBeenCalledOnce();
    expect(activityCreate.mock.calls[0]![0]).toMatchObject({
      data: {
        backlogItemId: "parent-row",
        kind: "plan_backlog_coverage",
        recordedById: "user-1",
        recordedByAgentId: "agent-1",
        payload: {
          planPath: "docs/superpowers/plans/example.md",
          decision: "decomposed",
          mappedItemIds: ["BI-EXISTING-1", "BI-EXISTING-2"],
        },
      },
    });
  });

  it("does not write a receipt when a mapped BI does not exist", async () => {
    const { db, activityCreate } = fakeDb();
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      decision: "decomposed",
      deliverables: [
        {
          key: "slice-missing",
          title: "Missing",
          independentlyShippable: true,
          backlogItemId: "BI-NOT-LIVE",
          dependsOn: [],
        },
      ],
      userId: "user-1",
      db,
    });

    expect(result).toMatchObject({ ok: false, code: "decomposition-required" });
    expect(activityCreate).not.toHaveBeenCalled();
  });
});
