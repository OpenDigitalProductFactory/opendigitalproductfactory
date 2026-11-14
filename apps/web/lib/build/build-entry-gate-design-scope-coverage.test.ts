import { describe, expect, it, vi } from "vitest";

import { buildPlanCoveragePayload, traceBuildPlanToAcceptance } from "@/lib/backlog/initiative-readiness/build-plan-coverage";
import { receipt } from "@/lib/backlog/initiative-readiness/entry-adapter.test-fixtures";
import { digestBuildArtifactValue } from "./build-artifact-provenance";
import { enforceBuildInitiativeReadiness } from "./build-entry-gate";
import { reviewedDesignScope } from "./record-build-plan-coverage";

// BI-9FA1F9CF: FB-9CAA65DE and FB-ADFA9D58 on the live install. Their items are
// bugs sized large and medium, so no delivery shape derives (§3.4 rules 1 and 3
// disagree) and their Workrooms carry none. The unshaped fix table owes
// PLAN_REQUIRED; the plan passed review, but no scope baseline ever existed to
// trace it to, so the gate refused PLAN_REQUIRED on every resume tick.

type Activity = { id: string; kind: string; gateKey: string | null; recordedAt: Date; payload: unknown };

const designDoc = { problemStatement: "Stuck PRs have no owner.", acceptanceCriteria: ["A sweep adopts every stuck PR.", "Adoption is idempotent."] };
const buildPlan = { tasks: [{ title: "Sweep", satisfies: ["AC-1"] }, { title: "Idempotency", satisfies: ["AC-2"] }] };
const PLAN_DIGEST = `sha256:${digestBuildArtifactValue(buildPlan)}`;

function coverageFor(design: unknown): Activity {
  // The writer's own scope helper: the gate must read what the writer records.
  const scope = reviewedDesignScope({ buildId: "FB-BUG", designDoc: design, designReview: { decision: "pass" } })!;
  const trace = traceBuildPlanToAcceptance(buildPlan, scope.acceptanceIds);
  if (!trace.complete) throw new Error("fixture");
  return {
    id: "coverage", kind: "plan_backlog_coverage", gateKey: null, recordedAt: new Date("2026-11-13T21:43:00.000Z"),
    payload: buildPlanCoveragePayload({
      itemId: "BI-ENTRY", buildId: "FB-BUG", revisionId: "rev-plan", planDigest: PLAN_DIGEST,
      baseline: scope.baseline, acceptanceIds: scope.acceptanceIds, trace, recordedAt: "2026-11-13T21:43:00.000Z",
    }),
  };
}

function unshapedBugBuild(stored: Activity[], design: unknown = designDoc) {
  const findUnique = vi.fn().mockImplementation(async (query: {
    select: { originator: { select: { activities: { where: { kind: { in: string[] } } } } } };
  }) => {
    const kinds = query.select.originator.select.activities.where.kind.in;
    return {
      id: "build-row", buildId: "FB-BUG", kind: "fix", originatingBacklogItemId: "bi-row",
      designDoc: design, designReview: { decision: "pass" }, buildPlan,
      originator: {
        id: "bi-row", itemId: "BI-ENTRY", title: "Stuck PRs have no owner", body: "Every stuck PR needs a room.",
        type: "product", source: "user-request", workType: "bug", scopeKind: "platform",
        archetypeCategories: [], archetypeIds: [],
        activities: stored.filter((activity) => kinds.includes(activity.kind)),
      },
    };
  });
  return {
    featureBuild: { findUnique },
    backlogItemActivity: { create: vi.fn().mockResolvedValue({ id: "decision-row" }) },
    buildActivity: { create: vi.fn().mockResolvedValue({ id: "build-activity" }) },
    // No delivery shape on the room: the unshaped table applies.
    workroom: { findFirst: vi.fn().mockResolvedValue({ scopeClaims: [] }) },
  };
}

const enterBuild = (db: ReturnType<typeof unshapedBugBuild>) => enforceBuildInitiativeReadiness({
  db, buildId: "FB-BUG", target: "implementation", targetPhase: "build", expectedPhase: "plan",
  evaluatedAt: "2026-11-13T22:00:00.000Z",
});

const unmetCodes = (result: Awaited<ReturnType<typeof enterBuild>>) =>
  [...result.decision.unmet, ...result.decision.blockers].map((entry) => entry.code);

describe("an unshaped fix build's reviewed plan enters build (BI-9FA1F9CF)", () => {
  const research = receipt("r-research", "research") as Activity;

  it("refuses PLAN_REQUIRED while no coverage is recorded", async () => {
    expect(unmetCodes(await enterBuild(unshapedBugBuild([research])))).toContain("PLAN_REQUIRED");
  });

  it("admits the build once its plan is covered against the reviewed design", async () => {
    const result = await enterBuild(unshapedBugBuild([research, coverageFor(designDoc)]));
    expect(unmetCodes(result)).not.toContain("PLAN_REQUIRED");
    expect(result.allowed).toBe(true);
  });

  it("refuses again when the design changed after the coverage was recorded", async () => {
    const changed = { ...designDoc, acceptanceCriteria: [...designDoc.acceptanceCriteria, "A third criterion."] };
    expect(unmetCodes(await enterBuild(unshapedBugBuild([research, coverageFor(designDoc)], changed)))).toContain("PLAN_REQUIRED");
  });
});
