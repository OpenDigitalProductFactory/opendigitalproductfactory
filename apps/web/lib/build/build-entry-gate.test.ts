import { describe, expect, it, vi } from "vitest";

import { enforceBuildInitiativeReadiness } from "./build-entry-gate";

function database(activities: unknown[] = []) {
  return {
    featureBuild: {
      findUnique: vi.fn().mockResolvedValue({
        id: "build-row",
        buildId: "FB-ENTRY",
        kind: "feature",
        originatingBacklogItemId: "bi-row",
        designReview: { decision: "pass" },
        planReview: { decision: "pass" },
        originator: {
          id: "bi-row",
          itemId: "BI-ENTRY",
          type: "portfolio",
          source: "user-request",
          workType: "feature",
          scopeKind: "platform",
          archetypeCategories: [],
          archetypeIds: [],
          activities,
        },
      }),
    },
    backlogItemActivity: {
      create: vi.fn().mockResolvedValue({ id: "decision-row" }),
    },
    buildActivity: {
      create: vi.fn().mockResolvedValue({ id: "build-activity" }),
    },
  };
}

describe("enforceBuildInitiativeReadiness", () => {
  it("does not treat legacy designReview or planReview JSON as governed evidence", async () => {
    const db = database();

    const result = await enforceBuildInitiativeReadiness({
      db,
      buildId: "FB-ENTRY",
      target: "implementation",
      targetPhase: "build",
      evaluatedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.unmet.map((entry) => entry.code)).toContain("SPEC_APPROVAL_REQUIRED");
    expect(db.backlogItemActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "initiative_readiness_decision" }),
    }));
  });

  it("fails closed when a governed build has no canonical backlog subject", async () => {
    const db = database();
    db.featureBuild.findUnique.mockResolvedValueOnce({
      id: "build-row",
      buildId: "FB-ORPHAN",
      kind: "feature",
      originatingBacklogItemId: null,
      originator: null,
    });

    const result = await enforceBuildInitiativeReadiness({
      db,
      buildId: "FB-ORPHAN",
      target: "plan",
      targetPhase: "plan",
      evaluatedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(result).toMatchObject({ allowed: false, error: "classification_required" });
    expect(db.buildActivity.create).toHaveBeenCalled();
  });

  it("returns an allowed decision from the shared projector without consulting advisory JSON", async () => {
    const db = database();
    const projectReadiness = vi.fn().mockReturnValue({
      governed: true,
      decision: {
        decisionId: "IRD-ALLOWED",
        policyVersion: "initiative-readiness.v1",
        subject: { kind: "backlog-item", id: "BI-ENTRY" },
        transitionObject: { kind: "feature-build", id: "FB-ENTRY", expectedVersion: "ideate", targetState: "plan" },
        profile: "feature",
        target: "plan",
        verdict: "allowed",
        satisfied: [],
        unmet: [],
        blockers: [],
        evaluatedAt: "2026-08-22T00:00:00.000Z",
      },
    });

    const result = await enforceBuildInitiativeReadiness({
      db,
      buildId: "FB-ENTRY",
      target: "plan",
      targetPhase: "plan",
      evaluatedAt: "2026-08-22T00:00:00.000Z",
      dependencies: { projectReadiness },
    });

    expect(result.allowed).toBe(true);
    expect(projectReadiness).toHaveBeenCalledWith(expect.objectContaining({
      activities: [],
      target: "plan",
    }));
  });
});
