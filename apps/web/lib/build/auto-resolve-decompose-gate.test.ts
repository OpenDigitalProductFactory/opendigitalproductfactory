// apps/web/lib/build/auto-resolve-decompose-gate.test.ts
//
// BI-C4F828B7 — autonomous resolution of the ideate decompose-required gate
// for governed-backlog autopilot builds.

import { describe, expect, it, vi } from "vitest";

import {
  autoResolveDecomposeRequiredGate,
  type AutoResolveDecomposeDeps,
} from "./auto-resolve-decompose-gate";
import type { DecompositionCandidate } from "./decomposition-candidates";

function candidate(id = "candidate-1"): DecompositionCandidate {
  return {
    candidateId: id,
    rationale: "sequential dependency chain",
    childScopes: [
      { childOrder: 1, title: "Part A", summary: "a", acceptanceCriteriaIndices: [0], dependsOn: [] },
      { childOrder: 2, title: "Part B", summary: "b", acceptanceCriteriaIndices: [1], dependsOn: [1] },
    ],
  };
}

function reviewWith(candidates: DecompositionCandidate[] | null): unknown {
  return {
    decision: "pass",
    issues: [],
    summary: "ok",
    sizeAssessment: { decision: "decompose-required" },
    ...(candidates ? { decompositionCandidates: { latest: candidates } } : {}),
  };
}

function makeDeps(overrides: Partial<AutoResolveDecomposeDeps> = {}): AutoResolveDecomposeDeps {
  return {
    proposeDecomposition: vi.fn(async () => ({ ok: true as const, candidates: [candidate()], rejected: [] })),
    approveDecomposition: vi.fn(async () => ({
      ok: true as const,
      epicId: "EP-ABC123",
      childBuildIds: ["FB-CHILD1", "FB-CHILD2"],
      childBacklogItemIds: ["BI-CHILD1", "BI-CHILD2"],
      unblockedChildBuildIds: ["FB-CHILD1"],
    })),
    recordDecompositionOverride: vi.fn(async () => ({
      ok: true as const,
      override: {
        rationale: "r",
        recordedAt: "2026-07-17T14:00:00.000Z",
        recordedByUserId: "u",
        recordedByAgentId: null,
      },
    })),
    ...overrides,
  };
}

describe("autoResolveDecomposeRequiredGate", () => {
  it("parks when governed-backlog is disabled (operator-driven install)", async () => {
    const deps = makeDeps();
    const result = await autoResolveDecomposeRequiredGate({
      build: {
        buildId: "FB-1",
        parentEpicId: null,
        originatingBacklogItemId: "bi-1",
        designReview: reviewWith([candidate()]),
      },
      userId: "u",
      governedBacklogEnabled: false,
      deps,
    });
    expect(result).toEqual({ action: "park" });
    expect(deps.approveDecomposition).not.toHaveBeenCalled();
    expect(deps.recordDecompositionOverride).not.toHaveBeenCalled();
  });

  it("parks when the build has no originating backlog item (not autopilot)", async () => {
    const deps = makeDeps();
    const result = await autoResolveDecomposeRequiredGate({
      build: {
        buildId: "FB-1",
        parentEpicId: null,
        originatingBacklogItemId: null,
        designReview: reviewWith([candidate()]),
      },
      userId: "u",
      governedBacklogEnabled: true,
      deps,
    });
    expect(result).toEqual({ action: "park" });
    expect(deps.approveDecomposition).not.toHaveBeenCalled();
  });

  it("auto-approves the top candidate when candidates already exist", async () => {
    const deps = makeDeps();
    const result = await autoResolveDecomposeRequiredGate({
      build: {
        buildId: "FB-1",
        parentEpicId: null,
        originatingBacklogItemId: "bi-1",
        designReview: reviewWith([candidate("candidate-1"), candidate("candidate-2")]),
      },
      userId: "u",
      governedBacklogEnabled: true,
      deps,
    });
    expect(result).toEqual({
      action: "decomposed",
      epicId: "EP-ABC123",
      childBuildIds: ["FB-CHILD1", "FB-CHILD2"],
      candidateId: "candidate-1",
    });
    // Did NOT need to generate candidates — they were already present.
    expect(deps.proposeDecomposition).not.toHaveBeenCalled();
    expect(deps.approveDecomposition).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "FB-1", candidate: expect.objectContaining({ candidateId: "candidate-1" }) }),
    );
  });

  it("generates candidates first when none are persisted, then approves", async () => {
    const deps = makeDeps();
    const result = await autoResolveDecomposeRequiredGate({
      build: {
        buildId: "FB-1",
        parentEpicId: null,
        originatingBacklogItemId: "bi-1",
        designReview: reviewWith(null),
      },
      userId: "u",
      governedBacklogEnabled: true,
      deps,
    });
    expect(deps.proposeDecomposition).toHaveBeenCalledWith({ buildId: "FB-1", userId: "u" });
    expect(result).toMatchObject({ action: "decomposed", epicId: "EP-ABC123" });
  });

  it("falls back to a monolithic override when candidates cannot be generated", async () => {
    const deps = makeDeps({
      proposeDecomposition: vi.fn(async () => ({ ok: false as const, code: "no-valid-candidates" as const, error: "none" })),
    });
    const result = await autoResolveDecomposeRequiredGate({
      build: {
        buildId: "FB-1",
        parentEpicId: null,
        originatingBacklogItemId: "bi-1",
        designReview: reviewWith(null),
      },
      userId: "u",
      governedBacklogEnabled: true,
      deps,
    });
    expect(deps.approveDecomposition).not.toHaveBeenCalled();
    expect(deps.recordDecompositionOverride).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ action: "overridden", reason: "no-candidates" });
  });

  it("falls back to a monolithic override when approval fails", async () => {
    const deps = makeDeps({
      approveDecomposition: vi.fn(async () => ({ ok: false as const, code: "invariant-violation" as const, error: "bad" })),
    });
    const result = await autoResolveDecomposeRequiredGate({
      build: {
        buildId: "FB-1",
        parentEpicId: null,
        originatingBacklogItemId: "bi-1",
        designReview: reviewWith([candidate()]),
      },
      userId: "u",
      governedBacklogEnabled: true,
      deps,
    });
    expect(deps.recordDecompositionOverride).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ action: "overridden", reason: "approve-failed" });
  });

  it("auto-overrides a decomposed child without attempting decomposition", async () => {
    const deps = makeDeps();
    const result = await autoResolveDecomposeRequiredGate({
      build: {
        buildId: "FB-CHILD",
        parentEpicId: "epic-row-1",
        originatingBacklogItemId: "bi-1",
        designReview: reviewWith([candidate()]),
      },
      userId: "u",
      governedBacklogEnabled: true,
      deps,
    });
    expect(deps.proposeDecomposition).not.toHaveBeenCalled();
    expect(deps.approveDecomposition).not.toHaveBeenCalled();
    expect(result).toMatchObject({ action: "overridden", reason: "child" });
  });

  it("parks if even the override write fails (never silently advances)", async () => {
    const deps = makeDeps({
      approveDecomposition: vi.fn(async () => ({ ok: false as const, code: "invariant-violation" as const, error: "bad" })),
      recordDecompositionOverride: vi.fn(async () => ({ ok: false as const, code: "build-not-found" as const, error: "gone" })),
    });
    const result = await autoResolveDecomposeRequiredGate({
      build: {
        buildId: "FB-1",
        parentEpicId: null,
        originatingBacklogItemId: "bi-1",
        designReview: reviewWith([candidate()]),
      },
      userId: "u",
      governedBacklogEnabled: true,
      deps,
    });
    expect(result).toEqual({ action: "park" });
  });
});
