import { beforeEach, describe, expect, it, vi } from "vitest";

import { digestBuildArtifactValue } from "./build-artifact-provenance";
import { recordBuildPlanCoverage, type RecordBuildPlanCoverageDb } from "./record-build-plan-coverage";

const plan = { fileStructure: [], tasks: [{ title: "One", satisfies: ["AC-1"] }, { title: "Two", satisfies: ["AC-2"] }] };
const PLAN_HEX = digestBuildArtifactValue(plan);

const baselinePayload = {
  schemaVersion: 1,
  baselineId: "baseline-1",
  supersedesBaselineId: null,
  subject: { kind: "backlog-item", id: "BI-1" },
  profile: "feature",
  artifactDigest: "sha256:design",
  artifactRef: { kind: "feature-build-revision", revisionId: "rev-design" },
  acceptanceStatements: [{ acceptanceId: "AC-1" }, { acceptanceId: "AC-2" }],
};

const designDoc = { problemStatement: "Problem", acceptanceCriteria: ["First criterion", "Second criterion"] };
const DESIGN_HEX = digestBuildArtifactValue(designDoc);

function build(overrides: Record<string, unknown> = {}) {
  return {
    buildId: "FB-1",
    phase: "plan",
    buildPlan: plan,
    planReview: { decision: "pass" },
    designDoc,
    designReview: { decision: "pass" },
    createdById: "user-1",
    originator: {
      id: "item-row",
      itemId: "BI-1",
      activities: [{ id: "a-baseline", kind: "initiative_scope_baseline", gateKey: null, recordedAt: new Date("2026-10-01"), payload: baselinePayload }],
    },
    ...overrides,
  };
}

let db: RecordBuildPlanCoverageDb & { saved: unknown[]; created: unknown[] };

function makeDb(row: unknown, acceptedPlan: { id: string; valueDigest: string } | null = null) {
  const created: unknown[] = [];
  const saved: unknown[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => []),
    backlogItemActivity: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: unknown) => { created.push(args); return { id: "coverage-row" }; }),
    },
  };
  return {
    saved,
    created,
    featureBuild: { findUnique: vi.fn(async () => row) },
    buildArtifactRevision: { findFirst: vi.fn(async () => acceptedPlan) },
    saveRevision: vi.fn(async (args: unknown) => { saved.push(args); return { revisionId: "rev-plan-new", status: "accepted" }; }),
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as RecordBuildPlanCoverageDb & { saved: unknown[]; created: unknown[] };
}

const now = () => new Date("2026-10-21T00:00:00.000Z");

describe("recordBuildPlanCoverage (BI-6F2872FC)", () => {
  beforeEach(() => { db = makeDb(build()); });

  it("records coverage for a reviewed, fully traced plan, bound to a freshly accepted plan revision", async () => {
    const outcome = await recordBuildPlanCoverage({ buildId: "FB-1", db, now });
    expect(outcome).toEqual({ recorded: true, activityId: "coverage-row", revisionId: "rev-plan-new" });
    expect(db.saved[0]).toMatchObject({ buildId: "FB-1", field: "buildPlan", value: plan, savedByUserId: "user-1", savedByAgentId: "AGT-WS-BUILD" });
    expect(db.created[0]).toMatchObject({ data: {
      backlogItemId: "item-row",
      kind: "plan_backlog_coverage",
      recordedByAgentId: "AGT-WS-BUILD",
      payload: {
        planArtifactRef: { kind: "feature-build-revision", field: "buildPlan", revisionId: "rev-plan-new", buildId: "FB-1" },
        planArtifactDigest: `sha256:${PLAN_HEX}`,
        scopeBaselineId: "baseline-1",
        scopeBaselineArtifactDigest: "sha256:design",
        deliverables: [{ backlogItemId: "BI-1", verificationRefs: ["AC-1", "AC-2"] }],
      },
    } });
  });

  it("reuses the accepted plan revision when it already holds this plan", async () => {
    db = makeDb(build(), { id: "rev-plan-1", valueDigest: PLAN_HEX });
    expect(await recordBuildPlanCoverage({ buildId: "FB-1", db, now })).toMatchObject({ recorded: true, revisionId: "rev-plan-1" });
    expect(db.saved).toHaveLength(0);
  });

  it("records nothing when this plan is already covered", async () => {
    const first = makeDb(build());
    await recordBuildPlanCoverage({ buildId: "FB-1", db: first, now });
    const coverage = { id: "c1", kind: "plan_backlog_coverage", gateKey: null, recordedAt: new Date("2026-10-20"),
      payload: (first.created[0] as { data: { payload: unknown } }).data.payload };
    const row = build();
    db = makeDb({ ...row, originator: { ...row.originator, activities: [...row.originator.activities, coverage] } },
      { id: "rev-plan-new", valueDigest: PLAN_HEX });
    expect(await recordBuildPlanCoverage({ buildId: "FB-1", db, now })).toEqual({ recorded: false, reason: "already-covered" });
    expect(db.created).toHaveLength(0);
  });

  it("names the untraced acceptance ids and records nothing", async () => {
    db = makeDb(build({ buildPlan: { tasks: [{ title: "One", satisfies: ["AC-1"] }] } }));
    expect(await recordBuildPlanCoverage({ buildId: "FB-1", db, now }))
      .toEqual({ recorded: false, reason: "acceptance-uncovered", detail: "AC-2" });
    expect(db.saved).toHaveLength(0);
    expect(db.created).toHaveLength(0);
  });

  it("reports a legacy plan whose tasks name no acceptance ids", async () => {
    db = makeDb(build({ buildPlan: { tasks: [{ title: "One" }] } }));
    expect(await recordBuildPlanCoverage({ buildId: "FB-1", db, now })).toMatchObject({ recorded: false, reason: "plan-untraced" });
  });

  it.each([
    ["not-in-plan", { phase: "build" }],
    ["plan-review-not-passed", { planReview: { decision: "fail" } }],
    ["plan-review-not-passed", { planReview: { decision: "pass", reviewIncomplete: true } }],
    ["no-backlog-subject", { originator: null }],
  ])("records nothing when %s", async (reason, overrides) => {
    db = makeDb(build(overrides));
    expect(await recordBuildPlanCoverage({ buildId: "FB-1", db, now })).toMatchObject({ recorded: false, reason });
    expect(db.created).toHaveLength(0);
  });

  // BI-9FA1F9CF: a fix judged on the unshaped table owes PLAN_REQUIRED but no
  // spec approval, so its item never holds a scope baseline. The reviewed build
  // design is the scope its plan is traced to.
  it("traces the plan to the reviewed build design when the item has no scope baseline of its own", async () => {
    const row = build();
    db = makeDb({ ...row, originator: { ...row.originator, activities: [] } });
    expect(await recordBuildPlanCoverage({ buildId: "FB-1", db, now })).toMatchObject({ recorded: true });
    expect(db.created[0]).toMatchObject({ data: {
      kind: "plan_backlog_coverage",
      payload: {
        scopeBaselineId: "build-design:FB-1",
        scopeBaselineArtifactDigest: `sha256:${DESIGN_HEX}`,
        deliverables: [{ backlogItemId: "BI-1", verificationRefs: ["AC-1", "AC-2"] }],
      },
    } });
  });

  it("prefers the item's own scope baseline over the build design", async () => {
    await recordBuildPlanCoverage({ buildId: "FB-1", db, now });
    expect(db.created[0]).toMatchObject({ data: { payload: { scopeBaselineId: "baseline-1" } } });
  });

  it.each([
    ["the design review did not pass", { designReview: { decision: "fail" } }],
    ["the design states no acceptance criteria", { designDoc: { problemStatement: "Problem" } }],
  ])("records nothing without a scope baseline when %s", async (_label, overrides) => {
    const row = build(overrides);
    db = makeDb({ ...row, originator: { ...row.originator, activities: [] } });
    expect(await recordBuildPlanCoverage({ buildId: "FB-1", db, now })).toMatchObject({ recorded: false, reason: "no-scope-baseline" });
    expect(db.created).toHaveLength(0);
  });

  it("does not record against a plan revision that was not accepted", async () => {
    db = makeDb(build());
    (db as unknown as { saveRevision: ReturnType<typeof vi.fn> }).saveRevision.mockResolvedValueOnce({ revisionId: "rev-w", status: "warning" });
    expect(await recordBuildPlanCoverage({ buildId: "FB-1", db, now })).toMatchObject({ recorded: false, reason: "plan-revision-not-accepted" });
    expect(db.created).toHaveLength(0);
  });
});

describe("describeBuildPlanCoverageOutcome", () => {
  it("tells the owner about a recorded coverage and about an untraceable plan", async () => {
    const { describeBuildPlanCoverageOutcome } = await import("./record-build-plan-coverage");
    expect(describeBuildPlanCoverageOutcome({ recorded: true, activityId: "a", revisionId: "r" })).toContain("revision r");
    expect(describeBuildPlanCoverageOutcome({ recorded: false, reason: "acceptance-uncovered", detail: "AC-2" })).toContain("AC-2");
    expect(describeBuildPlanCoverageOutcome({ recorded: false, reason: "plan-untraced" })).toContain("cannot be traced");
  });

  // BI-9FA1F9CF: this refusal used to be silent, so the build sat at plan with
  // a "nothing is waiting on your input" message and nobody was told why.
  it("tells the owner when there is no scope to trace the plan to", async () => {
    const { describeBuildPlanCoverageOutcome } = await import("./record-build-plan-coverage");
    expect(describeBuildPlanCoverageOutcome({ recorded: false, reason: "no-scope-baseline" })).toContain("no approved scope");
  });

  it("stays quiet for routine no-ops", async () => {
    const { describeBuildPlanCoverageOutcome } = await import("./record-build-plan-coverage");
    for (const reason of ["already-covered", "not-in-plan", "plan-review-not-passed"]) {
      expect(describeBuildPlanCoverageOutcome({ recorded: false, reason })).toBeNull();
    }
  });
});
