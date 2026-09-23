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

function shapedDatabase(activities: unknown[] = []) {
  const db = database(activities);
  return {
    ...db,
    backlogItemActivity: {
      ...db.backlogItemActivity,
      findMany: vi.fn().mockResolvedValue([{
        id: "cov-1",
        backlogItemId: "parent-row",
        payload: { schemaVersion: 2, decision: "decomposed", deliverables: [{ backlogItemId: "BI-ENTRY" }] },
      }]),
    },
    backlogItem: { findFirst: vi.fn().mockResolvedValue({ itemId: "BI-PARENT" }) },
    workroom: {
      findFirst: vi.fn().mockResolvedValue({
        scopeClaims: [{ workShape: "delivery-small@1.0.0", recordedAt: "2026-09-23T00:00:00.000Z" }],
      }),
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

  // BI-0E2E3BC5: with the shape bound (BI-1E8EAD10), a small or medium build
  // still owed a research receipt no agent it runs as can write. Its own
  // reviewed design is that research, and sensitivity raises the shape exactly
  // as it does at the claim and at closure.
  describe("reads the build's reviewed design and item sensitivity", () => {
    function shaped(args: { boundShape: string | null; title?: string; designReview?: unknown }) {
      const db = database();
      db.featureBuild.findUnique.mockResolvedValueOnce({
        id: "build-row",
        buildId: "FB-ENTRY",
        kind: "feature",
        originatingBacklogItemId: "bi-row",
        designDoc: { acceptanceCriteria: ["the page lists adoptable animals", { text: "each card links to a profile" }] },
        designReview: args.designReview === undefined ? { decision: "pass" } : args.designReview,
        originator: {
          id: "bi-row",
          itemId: "BI-ENTRY",
          title: args.title ?? "Adoptable animals page",
          body: "Show the animals available for adoption.",
          type: "product",
          source: "user-request",
          workType: "feature",
          scopeKind: "platform",
          archetypeCategories: [],
          archetypeIds: [],
          activities: [],
        },
      });
      const workroom = {
        findFirst: vi.fn().mockResolvedValue(
          args.boundShape ? { scopeClaims: [{ workShape: args.boundShape, recordedAt: "2026-09-22T00:00:00.000Z" }] } : null,
        ),
      };
      return Object.assign(db, { workroom });
    }
    const enforce = (db: ReturnType<typeof shaped>, target: "plan" | "implementation") => enforceBuildInitiativeReadiness({
      db,
      buildId: "FB-ENTRY",
      target,
      targetPhase: target === "plan" ? "plan" : "build",
      evaluatedAt: "2026-09-22T00:00:00.000Z",
    });
    const medium = "delivery-medium@1.0.0";

    it("lets a medium build with a passed design review enter plan and build", async () => {
      const plan = await enforce(shaped({ boundShape: medium }), "plan");
      expect(plan.decision.unmet.map((entry) => entry.code)).toEqual([]);
      expect(plan.allowed).toBe(true);
      expect((await enforce(shaped({ boundShape: medium }), "implementation")).allowed).toBe(true);
    });

    it("still refuses research when the design review failed", async () => {
      const result = await enforce(shaped({ boundShape: medium, designReview: { decision: "fail" } }), "plan");
      expect(result.allowed).toBe(false);
      expect(result.decision.unmet.map((entry) => entry.code)).toContain("RESEARCH_REQUIRED");
    });

    it("keeps large, sensitive and unshaped work on the full table", async () => {
      for (const db of [
        shaped({ boundShape: "delivery-large@1.0.0" }),
        shaped({ boundShape: medium, title: "Adopter login and password reset" }),
        shaped({ boundShape: null }),
      ]) {
        const result = await enforce(db, "plan");
        expect(result.allowed).toBe(false);
        expect(result.decision.unmet.map((entry) => entry.code)).toContain("SPEC_APPROVAL_REQUIRED");
      }
    });
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

  it("keys the gates on the bound delivery shape and inherits the decomposition parent's scope (BI-1E8EAD10)", async () => {
    const db = shapedDatabase();
    const projectReadiness = vi.fn().mockReturnValue({
      governed: true,
      decision: {
        decisionId: "IRD-SHAPED", policyVersion: "initiative-readiness.v3",
        subject: { kind: "backlog-item", id: "BI-ENTRY" },
        transitionObject: { kind: "feature-build", id: "FB-ENTRY", expectedVersion: "plan", targetState: "build" },
        profile: "feature", target: "implementation", verdict: "allowed",
        satisfied: [], unmet: [], blockers: [], evaluatedAt: "2026-09-23T00:00:00.000Z",
      },
    });

    await enforceBuildInitiativeReadiness({
      db, buildId: "FB-ENTRY", target: "implementation", targetPhase: "build", expectedPhase: "plan",
      evaluatedAt: "2026-09-23T00:00:00.000Z", dependencies: { projectReadiness },
    });

    const call = projectReadiness.mock.calls[0]![0] as { item: { workShape?: string | null }; inheritedScope?: unknown };
    expect(call.item.workShape).toBe("delivery-small@1.0.0");
    expect(call.inheritedScope).toBeTruthy();
  });
});
