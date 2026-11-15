import { describe, expect, it, vi } from "vitest";

import { recordPlanBacklogCoverage, type PlanBacklogCoverageDb } from "./plan-backlog-coverage";

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

// BI-86B638F7: readiness lets a plan child inherit its parent's scope baseline
// through the parent's coverage (baseline-source.ts, BI-2515F779), so a child
// never gets a spec-approval route of its own. The coverage writer used to read
// the child's own baseline rows only, so its coverage could never be recorded.
// Invariant: coverage is never recordable without SOME approved baseline: the
// child's own, or the one it inherits. With neither it is still refused.
describe("recordPlanBacklogCoverage with an inherited scope baseline (BI-86B638F7)", () => {
  const inheritedBaseline = {
    id: "grand-baseline-1",
    kind: "initiative_scope_baseline",
    gateKey: null,
    recordedAt: new Date("2026-10-28T00:00:00.000Z"),
    payload: baselineRows[0]!.payload,
  };
  const grandCoverage = {
    id: "grand-coverage-1",
    backlogItemId: "grand-row",
    payload: { schemaVersion: 2, decision: "decomposed", deliverables: [{ key: "p8", backlogItemId: "BI-PARENT" }] },
  };

  function inheritingDb(options: { parentCoverageMapsChild: boolean }) {
    const { db, activityCreate } = fakeDb();
    db.backlogItemActivity.findMany = vi.fn(async (args: { where: { kind?: unknown; backlogItemId?: unknown } }) => {
      const where = args.where;
      if (where.kind === "initiative_scope_baseline" && where.backlogItemId === "parent-row") return [];
      if (where.kind === "plan_backlog_coverage") return options.parentCoverageMapsChild ? [grandCoverage] : [];
      if (where.backlogItemId === "grand-row") return [inheritedBaseline];
      return [];
    }) as never;
    (db as unknown as { backlogItem: { findFirst: unknown } }).backlogItem.findFirst = vi.fn(async (args: { where: { id?: string } }) =>
      args.where.id === "grand-row" ? { itemId: "BI-GRAND" } : { id: "parent-row", itemId: "BI-PARENT" });
    return { db, activityCreate };
  }

  const atomic = {
    itemId: "BI-PARENT",
    planPath: "docs/superpowers/plans/example.md",
    planArtifactRef,
    decision: "atomic" as const,
    rationale: "The enforcement layers must ship together as one compatibility boundary.",
    deliverables: [{ key: "atomic", title: "Atomic repair", independentlyShippable: false, dependsOn: [], backlogItemId: "BI-PARENT", ...traceability }],
    userId: "user-1",
    now: () => new Date("2026-11-14T00:00:00.000Z"),
    resolveArtifact: resolvePlan,
  };

  it("records coverage bound to the inherited baseline when the child has none of its own", async () => {
    const { db, activityCreate } = inheritingDb({ parentCoverageMapsChild: true });
    const result = await recordPlanBacklogCoverage({ ...atomic, db });

    expect(result).toMatchObject({ ok: true });
    expect(activityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "plan_backlog_coverage",
        payload: expect.objectContaining({ schemaVersion: 2, scopeBaselineId: "baseline-1", scopeBaselineArtifactDigest: "sha256:design" }),
      }),
    }));
  });

  it("still refuses when the child has no baseline and inherits none", async () => {
    const { db, activityCreate } = inheritingDb({ parentCoverageMapsChild: false });
    const result = await recordPlanBacklogCoverage({ ...atomic, db });

    expect(result).toMatchObject({ ok: false, code: "traceability-incomplete" });
    expect(activityCreate).not.toHaveBeenCalled();
  });
});
