import { describe, expect, it, vi } from "vitest";

import { enforceBuildInitiativeReadiness } from "./build-entry-gate";

/** Ordinary query semantics for the two-room fixture, not a readiness stub. */
function roomMatches(room: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object") {
      const rule = expected as { in?: unknown[]; notIn?: unknown[] };
      if (rule.in) return rule.in.includes(room[key]);
      if (rule.notIn) return !rule.notIn.includes(room[key]);
    }
    return room[key] === expected;
  });
}

describe("review-stage exact native carrier (BI-1173F1CC)", () => {
  function fixture(planPath: string | null) {
    const db = database();
    db.featureBuild.findUnique.mockResolvedValue({
      id: "build-row", buildId: "FB-ENTRY", kind: "feature", originatingBacklogItemId: "bi-row",
      designDoc: { acceptanceCriteria: ["Retain the native plan and owner action"] }, designReview: { decision: "pass" },
      buildPlan: planPath ? { fileStructure: [{ path: planPath, action: "modify" }] } : null,
      originator: { id: "bi-row", itemId: "BI-ENTRY", title: "Native repair", body: "Retain the native plan.", type: "portfolio", source: "user-request", workType: "feature", scopeKind: "platform", archetypeCategories: [], archetypeIds: [], activities: [] },
    });
    const native = {
      id: "native-row", capsuleId: "WC-NATIVE", featureBuildId: "build-row", executorKind: "build-studio", executorRef: "FB-ENTRY",
      backlogItemId: "bi-row", archivedAt: null, status: "working", updatedAt: 1,
      scopeClaims: [{ workShape: "delivery-medium@1.0.0" }],
    };
    const external = {
      ...native, id: "external-row", capsuleId: "WC-EXTERNAL", featureBuildId: null, executorKind: "codex-desktop", executorRef: "another-chat", updatedAt: 2,
      scopeClaims: [{ workShape: "delivery-small@1.0.0" }, { kind: "path", intent: "edit", value: "docs/proposal.md" }],
    };
    const rooms = [native, external];
    const query = (args: { where: Record<string, unknown>; take?: number }) => rooms.filter(room => roomMatches(room, args.where));
    const workroom = {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => query(args).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null),
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take?: number }) => query(args).slice(0, args.take)),
    };
    const enforce = (expectedWorkroom?: { id: string; capsuleId: string }) => enforceBuildInitiativeReadiness({
      db: { ...db, workroom, backlogItem: { findFirst: vi.fn().mockResolvedValue({ id: "bi-row", itemId: "BI-ENTRY" }) } }, buildId: "FB-ENTRY", target: "implementation", targetPhase: "build", expectedPhase: "review",
      ...(expectedWorkroom ? { expectedWorkroom } : {}),
    });
    return { enforce, rooms, native, external, workroom };
  }

  it.each([
    ["apps/web/app/api/change-review/failure-readiness/resume/route.ts", "elevated"],
    ["apps/web/lib/auth/session.ts", "high"],
  ])("keeps the real native %s plan raised when another room is newer", async (path, sensitivity) => {
    const f = fixture(path!);
    const result = await f.enforce();
    expect(result.allowed).toBe(false);
    expect(result.decision.shapeDecision).toMatchObject({ declared: "medium", sensitivity, raised: true });
    expect(result.decision.unmet.map(entry => entry.code)).toContain("PLAN_REQUIRED");
  });

  it("uses the native declaration for benign already-shaped work, not the newer external declaration", async () => {
    const result = await fixture(null).enforce();
    expect(result.allowed).toBe(true);
    expect(result.decision.shapeDecision?.declared).toBe("medium");
  });

  it("does not let an external heartbeat after reconciliation alter the native gate", async () => {
    const f = fixture("apps/web/lib/auth/session.ts");
    f.native.updatedAt = 3; // metadata reconciliation has just made this room newest
    f.external.updatedAt = 4; // another chat heartbeats before readiness
    const result = await f.enforce({ id: f.native.id, capsuleId: f.native.capsuleId });
    expect(result.allowed).toBe(false);
    expect(result.decision.shapeDecision).toMatchObject({ declared: "medium", sensitivity: "high", raised: true });
  });

  it("holds a vanished or replaced admitted carrier rather than borrowing another room", async () => {
    const f = fixture(null);
    const result = await f.enforce({ id: "replaced-native-row", capsuleId: "WC-OLD" });
    expect(result.allowed).toBe(false);
    expect(result.decision.blockers.map(entry => entry.code)).toContain("CAPSULE_IDENTITY_MISMATCH");
  });
});

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
    function shaped(args: { boundShape: string | null; title?: string; designReview?: unknown; planPaths?: string[] }) {
      const db = database();
      db.featureBuild.findUnique.mockResolvedValueOnce({
        id: "build-row",
        buildId: "FB-ENTRY",
        kind: "feature",
        originatingBacklogItemId: "bi-row",
        designDoc: { acceptanceCriteria: ["the page lists adoptable animals", { text: "each card links to a profile" }] },
        designReview: args.designReview === undefined ? { decision: "pass" } : args.designReview,
        buildPlan: args.planPaths ? { fileStructure: args.planPaths.map((path) => ({ path, action: "modify" })) } : null,
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
        shaped({ boundShape: medium, planPaths: ["apps/web/lib/auth/password-reset.ts"] }),
        shaped({ boundShape: null }),
      ]) {
        const result = await enforce(db, "plan");
        expect(result.allowed).toBe(false);
        expect(result.decision.unmet.map((entry) => entry.code)).toContain("SPEC_APPROVAL_REQUIRED");
      }
    });

    // Operator direction 2026-10-07: a word is not evidence; the plan's files are.
    it("judges sensitivity by the files the plan touches, not by the words in the item", async () => {
      const wordy = await enforce(shaped({ boundShape: medium, title: "Adopter login and password reset", planPaths: ["apps/web/app/(shell)/adopt/page.tsx"] }), "implementation");
      expect(wordy.allowed).toBe(true);
      expect(wordy.decision.shapeDecision?.raised).toBe(false);
      const touchesAuth = await enforce(shaped({ boundShape: medium, title: "Adoptable animals page", planPaths: ["apps/web/lib/auth/session.ts"] }), "implementation");
      expect(touchesAuth.allowed).toBe(false);
      expect(touchesAuth.decision.shapeDecision?.trigger).toEqual({ signal: "access-control", source: "build-plan-paths", evidence: "apps/web/lib/auth/session.ts" });
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

describe("plan digest at plan -> build (BI-6F2872FC)", () => {
  async function projectedArgs(expectedPhase: string) {
    const db = database();
    db.featureBuild.findUnique.mockResolvedValueOnce({
      ...(await db.featureBuild.findUnique()),
      buildPlan: { tasks: [{ title: "t", satisfies: ["AC-1"] }] },
    });
    const projectReadiness = vi.fn().mockReturnValue({
      governed: true,
      decision: { decisionId: "unpersisted", verdict: "allowed", blockers: [], unmet: [], satisfied: [] },
    });
    await enforceBuildInitiativeReadiness({
      db, buildId: "FB-ENTRY", target: "implementation", targetPhase: expectedPhase === "plan" ? "build" : "ship",
      expectedPhase, evaluatedAt: "2026-10-21T00:00:00.000Z", dependencies: { projectReadiness },
    });
    return projectReadiness.mock.calls[0]![0] as Record<string, unknown>;
  }

  it("judges the coverage against the plan the build holds now", async () => {
    expect((await projectedArgs("plan")).buildPlanDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("does not re-judge the covered plan after the build started", async () => {
    expect(await projectedArgs("review")).not.toHaveProperty("buildPlanDigest");
  });
});
