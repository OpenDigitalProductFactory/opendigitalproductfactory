import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "./types";
import { buildDeliveryState, completeFeatureBuildTransition } from "./build-terminal-transition";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";

function projection(verdict: "allowed" | "input-required") {
  const decision: InitiativeReadinessDecision = {
    decisionId: "unpersisted",
    policyVersion: "initiative-readiness.v1",
    subject: { kind: "backlog-item", id: "BI-1" },
    transitionObject: { kind: "feature-build", id: "build-row-1", expectedVersion: "ship", targetState: "complete" },
    profile: "feature",
    target: "completion",
    verdict,
    satisfied: [],
    unmet: verdict === "allowed" ? [] : [readinessRequirement({ code: "OBJECTIVE_RECONCILIATION_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })],
    blockers: [],
    evaluatedAt: "2026-08-22T08:00:00.000Z",
  };
  return { governed: true, baselineId: "BASE-1", inheritedFrom: null, artifactHints: { hasSpec: true, hasPlan: true }, planArtifact: null, decision };
}

function fakeDb(overrides: Record<string, unknown> = {}) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const build = {
    id: "build-row-1", buildId: "FB-1", phase: "ship", kind: "feature",
    verificationOut: { typecheckPassed: true, testsFailed: 0, buildPassed: true },
    uxVerificationStatus: "complete",
    originator: {
      id: "row-1", itemId: "BI-1", type: "portfolio", source: "user-request", workType: "feature",
      scopeKind: "platform", archetypeCategories: [], archetypeIds: [], organizationId: "org-1",
      submittedById: "user-1", activities: [],
    },
    ...overrides,
  };
  const tx = {
    $queryRawUnsafe: vi.fn(async () => []),
    featureBuild: { findUnique: vi.fn(async () => build), updateMany },
    backlogItemActivity: { create: vi.fn(async (args: unknown) => args) },
    authorizationDecisionLog: { create: vi.fn(async (args: unknown) => args) },
  };
  return { updateMany, db: { $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => work(tx) } };
}

describe("completeFeatureBuildTransition", () => {
  it("keeps the build in ship when objective reconciliation is incomplete", async () => {
    const fake = fakeDb();
    const result = await completeFeatureBuildTransition({
      db: fake.db,
      buildId: "FB-1",
      expectedPhase: "ship",
      dependencies: {
        reconcileObjectives: () => ({ state: "missing", baselineId: "BASE-1", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projection("input-required"),
      },
    });
    expect(result).toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it("uses a phase CAS after build delivery and objective evidence pass", async () => {
    const fake = fakeDb();
    const result = await completeFeatureBuildTransition({
      db: fake.db,
      buildId: "FB-1",
      expectedPhase: "ship",
      dependencies: {
        reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["E-1"], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projection("allowed"),
      },
    });
    expect(result.ok).toBe(true);
    expect(fake.updateMany).toHaveBeenCalledWith({
      where: { id: "build-row-1", phase: "ship" },
      data: { phase: "complete" },
    });
  });
});

// BI-3555F94E: completion judges a build the way every other build gate does.
describe("completeFeatureBuildTransition — the build's own facts", () => {
  const facts = {
    workShape: "delivery-medium@1.0.0",
    inheritedScope: null,
    deliverySensitivity: { level: "low", trigger: null },
    buildDesign: { reviewPassed: true, acceptanceCriteriaCount: 4 },
  };

  it("hands the bound shape, sensitivity, inherited scope and reviewed design to the projector", async () => {
    const fake = fakeDb();
    const projectReadiness = vi.fn(() => projection("allowed"));
    await completeFeatureBuildTransition({
      db: fake.db, buildId: "FB-1", expectedPhase: "ship",
      dependencies: {
        reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["E-1"], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: projectReadiness as never,
        loadFacts: async () => facts as never,
      },
    });
    const input = (projectReadiness.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(input.item).toMatchObject({ workShape: "delivery-medium@1.0.0", deliverySensitivity: facts.deliverySensitivity });
    expect(input.buildDesign).toEqual(facts.buildDesign);
    expect(input).toHaveProperty("inheritedScope", null);
  });

  it("falls back to the unshaped evaluation when the facts cannot be read", async () => {
    const fake = fakeDb();
    const projectReadiness = vi.fn(() => projection("input-required"));
    await completeFeatureBuildTransition({
      db: fake.db, buildId: "FB-1", expectedPhase: "ship",
      dependencies: {
        reconcileObjectives: () => ({ state: "missing", baselineId: null, evidenceRefs: [], requiredStatementIds: [] }),
        projectReadiness: projectReadiness as never,
        loadFacts: async () => { throw new Error("db down"); },
      },
    });
    const input = (projectReadiness.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(input.item).not.toHaveProperty("workShape");
    expect(input).not.toHaveProperty("buildDesign");
  });

  it("reads delivery as passed on proven delivery without a buildPassed field, and on settled UX only", () => {
    const verified = { verificationOut: { typecheckPassed: true, testsFailed: 0 } };
    expect(buildDeliveryState({ ...verified, uxVerificationStatus: "skipped" }, true)).toBe("pass");
    expect(buildDeliveryState({ ...verified, uxVerificationStatus: "complete" }, true)).toBe("pass");
    expect(buildDeliveryState({ ...verified, uxVerificationStatus: "skipped" }, false)).toBe("missing");
    expect(buildDeliveryState({ ...verified, uxVerificationStatus: "failed" }, true)).toBe("missing");
    expect(buildDeliveryState({ ...verified, uxVerificationStatus: null }, true)).toBe("missing");
    expect(buildDeliveryState({ verificationOut: { typecheckPassed: false, testsFailed: 0 }, uxVerificationStatus: "complete" }, true)).toBe("missing");
    expect(buildDeliveryState({ verificationOut: { typecheckPassed: true, testsFailed: 0, buildPassed: true }, uxVerificationStatus: "complete" })).toBe("pass");
  });
});

// BI-729D9B27: a delivered medium build mints the body baseline its acceptance is mapped against.
describe("completeFeatureBuildTransition — body baseline on proven delivery", () => {
  function owedAcceptance(effective: string) {
    const p = projection("input-required");
    return {
      ...p,
      decision: {
        ...p.decision,
        shapeDecision: { declared: effective, effective, sensitivity: "low", raised: false, trigger: null },
        unmet: [readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })],
      },
    };
  }
  const verified = { verificationOut: { typecheckPassed: true, testsFailed: 0 }, uxVerificationStatus: "skipped" };
  const run = (opts: { deliveryProven: boolean; effective: string; minted?: boolean; build?: Record<string, unknown> }) => {
    const fake = fakeDb({ ...verified, ...(opts.build ?? {}) });
    const mintBodyBaseline = vi.fn(async () => opts.minted ?? true);
    const projectReadiness = vi.fn(() => owedAcceptance(opts.effective));
    return completeFeatureBuildTransition({
      db: fake.db, buildId: "FB-1", expectedPhase: "ship", deliveryProven: opts.deliveryProven,
      dependencies: {
        reconcileObjectives: () => ({ state: "missing", baselineId: null, evidenceRefs: [], requiredStatementIds: [] }),
        projectReadiness: projectReadiness as never,
        loadFacts: async () => null,
        mintBodyBaseline: mintBodyBaseline as never,
      },
    }).then((result) => ({ result, mintBodyBaseline, projectReadiness, fake }));
  };

  it("mints once delivery is proven, then re-projects on the new history", async () => {
    const { result, mintBodyBaseline, projectReadiness, fake } = await run({ deliveryProven: true, effective: "medium" });
    expect(mintBodyBaseline).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itemRowId: "row-1", effectiveShape: "medium" }));
    expect(projectReadiness).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { deliveryProven: false, effective: "medium" },
    { deliveryProven: true, effective: "large" },
    { deliveryProven: true, effective: "medium", build: { uxVerificationStatus: "failed" } },
  ])("does not mint without proven, passing delivery on a medium shape (%j)", async (opts) => {
    const { mintBodyBaseline } = await run(opts);
    expect(mintBodyBaseline).not.toHaveBeenCalled();
  });

  it("does not re-project when nothing was minted", async () => {
    const { projectReadiness } = await run({ deliveryProven: true, effective: "medium", minted: false });
    expect(projectReadiness).toHaveBeenCalledTimes(1);
  });
});
