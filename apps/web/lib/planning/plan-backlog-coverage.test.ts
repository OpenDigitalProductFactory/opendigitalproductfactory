import { describe, expect, it, vi } from "vitest";

import {
  checkBranchPlanBacklogGate,
  checkPlanBacklogCoverage,
  projectPlanBacklogDependencies,
  recordPlanBacklogCoverage,
  validatePlanBacklogCoverage,
  validatePlanBacklogCoverageReceipt,
  type PlanBacklogCoverageDb,
} from "./plan-backlog-coverage";

const fiveSlices = Array.from({ length: 5 }, (_, index) => ({
  key: `slice-${index + 1}`,
  title: `Future slice ${index + 1}`,
  independentlyShippable: true,
  backlogItemId: index === 0 ? "BI-EXISTING-1" : undefined,
  dependsOn: index === 0 ? [] : [`slice-${index}`],
}));

const planArtifactRef = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: "a".repeat(40),
  path: "docs/superpowers/plans/example.md",
  providerBlobId: "b".repeat(40),
};
const traceability = {
  requirementRefs: ["OBJ-TEST-001"],
  contractRefs: ["contract:test"],
  flowRefs: ["flow:test"],
  verificationRefs: ["AC-TEST-001"],
};
const planText = [
  "OBJ-1", "OBJ-2", "OBJ-TEST-001", "AC-1", "AC-2", "AC-TEST-001",
  "contract:receipt-v1", "contract:transition", "contract:test",
  "flow:claim-to-complete", "flow:completion", "flow:test",
].join("\n");
const traceabilityContext = {
  planText,
  baselineId: "baseline-1",
  baselineArtifactDigest: "sha256:design",
  objectiveIds: ["OBJ-1", "OBJ-2"],
  acceptanceIds: ["AC-1", "AC-2"],
};
const baselineRows = [{ payload: {
  baselineId: "baseline-1",
  supersedesBaselineId: null,
  artifactDigest: "sha256:design",
  objectiveStatements: [{ objectiveId: "OBJ-TEST-001" }],
  acceptanceStatements: [{ acceptanceId: "AC-TEST-001" }],
} }];
const resolvePlan = vi.fn(async () => ({
  ok: true as const,
  artifact: { digest: "sha256:plan", bytes: Buffer.from(planText), authorPrincipalId: "p", authorAgentId: "a", authorEmail: "author@example.com" },
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

describe("validatePlanBacklogCoverageReceipt v2", () => {
  const v2 = {
    schemaVersion: 2 as const,
    planPath: "docs/superpowers/plans/example.md",
    planArtifactRef: {
      kind: "repo-blob-at-commit" as const,
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "abc123",
      path: "docs/superpowers/plans/example.md",
      providerBlobId: "blob-1",
    },
    planArtifactDigest: "sha256:plan",
    scopeBaselineId: "baseline-1",
    scopeBaselineArtifactDigest: "sha256:design",
    decision: "decomposed" as const,
    deliverables: [
      {
        key: "slice-1",
        title: "First",
        independentlyShippable: true,
        backlogItemId: "BI-EXISTING-1",
        dependsOn: [],
        requirementRefs: ["OBJ-1"],
        contractRefs: ["contract:receipt-v1"],
        flowRefs: ["flow:claim-to-complete"],
        verificationRefs: ["AC-1"],
      },
      {
        key: "slice-2",
        title: "Second",
        independentlyShippable: true,
        backlogItemId: "BI-EXISTING-2",
        dependsOn: ["slice-1"],
        requirementRefs: ["OBJ-2"],
        contractRefs: ["contract:transition"],
        flowRefs: ["flow:completion"],
        verificationRefs: ["AC-2"],
      },
    ],
  };

  it("keeps v1 readable but refuses it as governed implementation evidence", () => {
    expect(validatePlanBacklogCoverageReceipt({
      receipt: { ...v2, schemaVersion: 1, planArtifactRef: undefined, planArtifactDigest: undefined },
      mappedBacklogItems: [],
      requireGovernedImplementation: true,
      currentPlanDigest: "sha256:plan",
      traceabilityContext,
    })).toMatchObject({ ok: false, code: "coverage-v2-required" });
  });

  it("accepts immutable v2 traceability and live dependency state", () => {
    expect(validatePlanBacklogCoverageReceipt({
      receipt: v2,
      mappedBacklogItems: [
        { itemId: "BI-EXISTING-1", status: "complete" },
        { itemId: "BI-EXISTING-2", status: "open" },
      ],
      requireGovernedImplementation: true,
      currentPlanDigest: "sha256:plan",
      traceabilityContext,
    })).toMatchObject({ ok: true, schemaVersion: 2 });
  });

  it("projects done and accountable dispositions without treating bare deferred status as success", () => {
    expect(projectPlanBacklogDependencies(v2, [
      { itemId: "BI-EXISTING-1", status: "done" },
      { itemId: "BI-EXISTING-2", status: "open" },
    ])).toEqual({ state: "pass", unresolvedDeliverableKeys: [] });

    expect(projectPlanBacklogDependencies(v2, [
      { itemId: "BI-EXISTING-1", status: "deferred" },
      { itemId: "BI-EXISTING-2", status: "open" },
    ])).toEqual({ state: "fail", unresolvedDeliverableKeys: ["slice-1"] });

    const disposed = {
      ...v2,
      deliverables: v2.deliverables.map((deliverable) => deliverable.key === "slice-1"
        ? { ...deliverable, disposition: { decision: "deferred" as const, reason: "Upstream work was accountably deferred outside this release." } }
        : deliverable),
    };
    expect(projectPlanBacklogDependencies(disposed, [
      { itemId: "BI-EXISTING-1", status: "deferred" },
      { itemId: "BI-EXISTING-2", status: "open" },
    ])).toEqual({ state: "pass", unresolvedDeliverableKeys: [] });
  });

  it.each([
    ["stale digest", { currentPlanDigest: "sha256:new" }, "stale-plan-artifact"],
    ["non-canonical plan path", { receipt: {
      ...v2,
      planPath: "docs/superpowers/specs/not-a-plan.md",
      planArtifactRef: { ...v2.planArtifactRef, path: "docs/superpowers/specs/not-a-plan.md" },
    } }, "stale-plan-artifact"],
    ["missing traceability", { receipt: { ...v2, deliverables: [{ ...v2.deliverables[0], verificationRefs: [] }] } }, "traceability-incomplete"],
    ["cycle", { receipt: { ...v2, deliverables: v2.deliverables.map((item, index) => ({ ...item, dependsOn: [v2.deliverables[1 - index]!.key] })) } }, "invalid-deliverable-graph"],
  ])("rejects %s", (_label, overrides, code) => {
    expect(validatePlanBacklogCoverageReceipt({
      receipt: v2,
      mappedBacklogItems: [
        { itemId: "BI-EXISTING-1", status: "complete" },
        { itemId: "BI-EXISTING-2", status: "open" },
      ],
      requireGovernedImplementation: true,
      currentPlanDigest: "sha256:plan",
      traceabilityContext,
      ...overrides,
    })).toMatchObject({ ok: false, code });
  });

  // BI-38A353B2: two prior sessions bisected these refusals by trial because
  // the text restated the rule instead of naming the offending value.
  describe("a refusal names the offending value, not just the rule", () => {
    it("names the deliverable whose traceability is incomplete", () => {
      const result = validatePlanBacklogCoverageReceipt({
        receipt: { ...v2, deliverables: [{ ...v2.deliverables[0]!, verificationRefs: [] }] },
        mappedBacklogItems: [{ itemId: "BI-EXISTING-1", status: "open" }],
        requireGovernedImplementation: true,
        currentPlanDigest: "sha256:plan",
        traceabilityContext,
      });
      expect(result).toMatchObject({ ok: false, code: "traceability-incomplete" });
      expect((result as { error: string }).error).toContain(v2.deliverables[0]!.key);
    });

    it("names which acceptance ids no deliverable verifies", () => {
      const result = validatePlanBacklogCoverageReceipt({
        receipt: v2,
        mappedBacklogItems: [
          { itemId: "BI-EXISTING-1", status: "open" },
          { itemId: "BI-EXISTING-2", status: "open" },
        ],
        requireGovernedImplementation: true,
        currentPlanDigest: "sha256:plan",
        traceabilityContext: { ...traceabilityContext, acceptanceIds: [...traceabilityContext.acceptanceIds, "AC-ORPHAN"] },
      });
      expect(result).toMatchObject({ ok: false, code: "traceability-incomplete" });
      expect((result as { error: string }).error).toContain("AC-ORPHAN");
    });

    it("names which traceability input is absent rather than 'could not be resolved'", () => {
      const result = validatePlanBacklogCoverageReceipt({
        receipt: v2,
        mappedBacklogItems: [{ itemId: "BI-EXISTING-1", status: "open" }],
        requireGovernedImplementation: true,
        currentPlanDigest: "sha256:plan",
        traceabilityContext: { ...traceabilityContext, acceptanceIds: [] },
      });
      expect(result).toMatchObject({ ok: false, code: "traceability-incomplete" });
      expect((result as { error: string }).error).toContain("acceptance ids");
    });
  });

  it("rejects arbitrary non-empty refs and requires every current acceptance criterion to be covered", () => {
    expect(validatePlanBacklogCoverageReceipt({
      receipt: {
        ...v2,
        deliverables: [{ ...v2.deliverables[0], requirementRefs: ["x"], verificationRefs: ["AC-1"] }],
      },
      mappedBacklogItems: [{ itemId: "BI-EXISTING-1", status: "open" }],
      requireGovernedImplementation: true,
      currentPlanDigest: "sha256:plan",
      traceabilityContext,
    })).toMatchObject({ ok: false, code: "traceability-incomplete" });
  });

  it("rejects a receipt after semantic scope changes even when statement IDs are reused", () => {
    expect(validatePlanBacklogCoverageReceipt({
      receipt: v2,
      mappedBacklogItems: [
        { itemId: "BI-EXISTING-1", status: "open" },
        { itemId: "BI-EXISTING-2", status: "open" },
      ],
      requireGovernedImplementation: true,
      currentPlanDigest: "sha256:plan",
      traceabilityContext: {
        ...traceabilityContext,
        baselineId: "baseline-2",
        baselineArtifactDigest: "sha256:changed-design",
      },
    })).toMatchObject({ ok: false, code: "stale-scope-baseline" });
  });
});

function fakeDb(): {
  db: PlanBacklogCoverageDb;
  activityCreate: ReturnType<typeof vi.fn>;
} {
  const activityCreate = vi.fn(async () => ({ id: "activity-receipt-1" }));
  const tx = {
    $queryRaw: async <T>(strings: TemplateStringsArray, ..._values: unknown[]) => (
      strings.join("").includes('FROM "WorkCapsule"')
        ? [{ id: "workroom-row", createdByPrincipalId: "p" }]
        : [{ id: "parent-row" }]
    ) as unknown as T,
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
    backlogItemActivity: { create: activityCreate, findMany: vi.fn(async () => baselineRows) },
  };
  return {
    activityCreate,
    db: { ...tx, $transaction: vi.fn(async (work) => work(tx)) },
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
    })).resolves.toMatchObject({ ok: false, valid: false, code: "receipt-invalid" });
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
    })).resolves.toMatchObject({ ok: false, valid: false, code: "receipt-invalid" });
  });
});

describe("checkBranchPlanBacklogGate", () => {
  it("requires a coverage decision before source work on a claimed xlarge BI", async () => {
    const result = await checkBranchPlanBacklogGate({
      branchName: "fix/xlarge-plan",
      db: {
        workroom: { findFirst: vi.fn(async () => ({ backlogItemId: "BI-PARENT" })) },
        backlogItem: {
          findUnique: vi.fn(async () => ({ id: "parent-row", itemId: "BI-PARENT", effortSize: "xlarge" })),
          findMany: vi.fn(async () => []),
        },
        backlogItemActivity: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => baselineRows) },
      },
    });
    expect(result).toMatchObject({ ok: false, required: true, code: "decomposition-decision-required" });
  });

  it("does not require a hard decision for a claimed non-xlarge BI without a changed plan", async () => {
    const result = await checkBranchPlanBacklogGate({
      branchName: "fix/small-plan",
      db: {
        workroom: { findFirst: vi.fn(async () => ({ backlogItemId: "BI-PARENT" })) },
        backlogItem: {
          findUnique: vi.fn(async () => ({ id: "parent-row", itemId: "BI-PARENT", effortSize: "large" })),
          findMany: vi.fn(async () => []),
        },
        backlogItemActivity: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => baselineRows) },
      },
    });
    expect(result).toEqual({ ok: true, required: false, itemId: "BI-PARENT" });
  });

  it("rejects legacy coverage at the governed xlarge branch gate", async () => {
    const result = await checkBranchPlanBacklogGate({
      branchName: "feat/governed-xlarge",
      db: {
        workroom: { findFirst: vi.fn(async () => ({ backlogItemId: "BI-PARENT" })) },
        backlogItem: {
          findUnique: vi.fn(async () => ({ id: "parent-row", itemId: "BI-PARENT", effortSize: "xlarge" })),
          findMany: vi.fn(async () => []),
        },
        backlogItemActivity: { findMany: vi.fn(async () => baselineRows), findFirst: vi.fn(async () => ({
          id: "legacy",
          payload: { decision: "atomic", rationale: "One indivisible change with no independent slices.", deliverables: [] },
        })) },
      },
    });
    expect(result).toMatchObject({ ok: false, required: true, code: "receipt-invalid" });
  });

  it("re-resolves and accepts current version 2 coverage at the governed branch gate", async () => {
    const result = await checkBranchPlanBacklogGate({
      branchName: "feat/governed-xlarge",
      resolveArtifact: resolvePlan,
      db: {
        workroom: { findFirst: vi.fn(async () => ({ backlogItemId: "BI-PARENT" })) },
        backlogItem: {
          findUnique: vi.fn(async () => ({ id: "parent-row", itemId: "BI-PARENT", effortSize: "xlarge" })),
          findMany: vi.fn(async () => [{ itemId: "BI-CHILD", status: "open" }]),
        },
        backlogItemActivity: { findMany: vi.fn(async () => baselineRows), findFirst: vi.fn(async () => ({
          id: "coverage-v2",
          payload: {
            schemaVersion: 2,
            planPath: planArtifactRef.path,
            planArtifactRef,
            planArtifactDigest: "sha256:plan",
            scopeBaselineId: "baseline-1",
            scopeBaselineArtifactDigest: "sha256:design",
            decision: "decomposed",
            deliverables: [{
              key: "slice",
              title: "Independent slice",
              independentlyShippable: true,
              backlogItemId: "BI-CHILD",
              dependsOn: [],
              ...traceability,
            }],
          },
        })) },
      },
    });
    expect(result).toMatchObject({ ok: true, required: true, receiptId: "coverage-v2", decision: "decomposed" });
  });
});

describe("recordPlanBacklogCoverage", () => {
  it("completes immutable provider I/O before opening the serializable transaction", async () => {
    const { db } = fakeDb();
    let providerComplete = false;
    const resolveArtifact = vi.fn(async () => {
      expect(db.$transaction).not.toHaveBeenCalled();
      providerComplete = true;
      return resolvePlan();
    });

    await recordPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "atomic",
      rationale: "The enforcement layers must ship together as one compatibility boundary.",
      deliverables: [{
        key: "atomic",
        title: "Atomic repair",
        independentlyShippable: false,
        dependsOn: [],
        ...traceability,
      }],
      userId: "user-1",
      db,
      resolveArtifact,
    });

    expect(resolveArtifact).toHaveBeenCalledOnce();
    expect(providerComplete).toBe(true);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("records one structured receipt after live BI validation", async () => {
    const { db, activityCreate } = fakeDb();
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "decomposed",
      deliverables: [
        {
          key: "slice-1",
          title: "First",
          independentlyShippable: true,
          backlogItemId: "BI-EXISTING-1",
          dependsOn: [],
          ...traceability,
        },
        {
          key: "slice-2",
          title: "Second",
          independentlyShippable: true,
          backlogItemId: "BI-EXISTING-2",
          dependsOn: ["slice-1"],
          ...traceability,
        },
      ],
      userId: "user-1",
      agentId: "agent-1",
      db,
      now: () => new Date("2026-07-20T03:00:00.000Z"),
      resolveArtifact: resolvePlan,
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
          scopeBaselineId: "baseline-1",
          scopeBaselineArtifactDigest: "sha256:design",
          decision: "decomposed",
          mappedItemIds: ["BI-EXISTING-1", "BI-EXISTING-2"],
        },
      },
    });
  });

  it("fails if Workroom authorship changes after immutable preflight", async () => {
    const { db, activityCreate } = fakeDb();
    const tx = db as PlanBacklogCoverageDb & { $queryRaw: NonNullable<PlanBacklogCoverageDb["$queryRaw"]> };
    tx.$queryRaw = async <T>(strings: TemplateStringsArray, ..._values: unknown[]) => (
      strings.join("").includes('FROM "WorkCapsule"')
        ? [{ id: "workroom-row", createdByPrincipalId: "different-principal" }]
        : [{ id: "parent-row" }]
    ) as unknown as T;
    db.$transaction = vi.fn(async (work) => work(tx));

    const result = await recordPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "atomic",
      rationale: "The enforcement layers must ship together as one compatibility boundary.",
      deliverables: [{
        key: "atomic",
        title: "Atomic repair",
        independentlyShippable: false,
        dependsOn: [],
        ...traceability,
      }],
      userId: "user-1",
      db,
      resolveArtifact: resolvePlan,
    });

    expect(result).toMatchObject({ ok: false, code: "plan-artifact-invalid" });
    expect(activityCreate).not.toHaveBeenCalled();
  });

  // BI-B9403248: an external session that hits this has no route forward and no
  // way to learn there is one — the baseline is minted by the initiative
  // spec-approval gate. The message must say so.
  //
  // BI-38A353B2: and it must say so WITHOUT citing a backlog id. The previous
  // text told callers to cite BI-B9403248, which closed on 2026-08-21 while
  // the block stayed live, so the gate instructed contributors to blame a
  // fixed defect. A condition does not go stale; an id does.
  it("names the missing scope baseline and how it is minted, instead of failing opaquely", async () => {
    const { db, activityCreate } = fakeDb();
    db.backlogItemActivity.findMany = vi.fn(async () => []);
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "decomposed",
      deliverables: [
        {
          key: "slice-1",
          title: "First",
          independentlyShippable: true,
          backlogItemId: "BI-EXISTING-1",
          dependsOn: [],
          ...traceability,
        },
      ],
      userId: "user-1",
      agentId: "agent-1",
      db,
      now: () => new Date("2026-07-20T03:00:00.000Z"),
      resolveArtifact: resolvePlan,
    });

    expect(result).toMatchObject({ ok: false, code: "traceability-incomplete" });
    const error = (result as { error: string }).error;
    expect(error).toContain("BI-PARENT");
    expect(error).toContain("initiative scope baseline");
    expect(error).toContain("record_initiative_design_review");
    expect(error).toContain("spec-approval");
    expect(error).toContain("independent");
    // The remediation must not hand the caller a backlog id to cite: the id
    // goes stale the moment it closes, the condition never does.
    expect(error).not.toMatch(/\b(?:BI|EP)-[0-9A-F]{8}\b/);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("does not write a receipt when a mapped BI does not exist", async () => {
    const { db, activityCreate } = fakeDb();
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/plans/example.md",
      planArtifactRef,
      decision: "decomposed",
      deliverables: [
        {
          key: "slice-missing",
          title: "Missing",
          independentlyShippable: true,
          backlogItemId: "BI-NOT-LIVE",
          dependsOn: [],
          ...traceability,
        },
      ],
      userId: "user-1",
      db,
      resolveArtifact: resolvePlan,
    });

    expect(result).toMatchObject({ ok: false, code: "decomposition-required" });
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-canonical plan path before provider access", async () => {
    const { db, activityCreate } = fakeDb();
    const resolveArtifact = vi.fn(async () => ({
      ok: true as const,
      artifact: { digest: "sha256:plan", bytes: Buffer.from(planText), authorPrincipalId: "p", authorAgentId: "a", authorEmail: "author@example.com" },
    }));
    const result = await recordPlanBacklogCoverage({
      itemId: "BI-PARENT",
      planPath: "docs/superpowers/specs/not-a-plan.md",
      planArtifactRef: { ...planArtifactRef, path: "docs/superpowers/specs/not-a-plan.md" },
      decision: "atomic",
      rationale: "This is intentionally atomic for a fully documented compatibility boundary.",
      deliverables: [],
      userId: "user-1",
      db,
      resolveArtifact,
    });

    expect(result).toMatchObject({ ok: false, code: "plan-artifact-invalid" });
    expect(resolveArtifact).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
  });
});
