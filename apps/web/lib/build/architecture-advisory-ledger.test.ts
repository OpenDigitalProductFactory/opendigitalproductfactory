import { describe, expect, it, vi } from "vitest";

const { gate } = vi.hoisted(() => ({ gate: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/decision-perspective/profession-gate", () => ({ evaluateProfessionDecisionGate: gate }));
vi.mock("@/lib/process-spine/canonical-improvement-digest", () => ({
  promoteReferenceDocFindings: vi.fn().mockResolvedValue(undefined),
}));

import type { ReviewResult } from "@/lib/explore/feature-build-types";

import { architectProposedOption, finalizeArchitectureAdvisory } from "./architecture-advisory-ledger";
import { reviewedArtifactDigest } from "./architecture-advisory-outcome";

function review(decision: ReviewResult["decision"], issues: ReviewResult["issues"] = []): ReviewResult {
  return { decision, issues, summary: "The design reuses the existing ledger." } as ReviewResult;
}

describe("the architect's recommendation (BI-AE416D75)", () => {
  it("is its review verdict: pass is aligned, fail is revise-before-building, inconclusive is none", () => {
    expect(architectProposedOption({ decision: "pass" })).toBe("aligned");
    expect(architectProposedOption({ decision: "fail" })).toBe("revise-before-building");
    expect(architectProposedOption({ decision: "inconclusive" })).toBeNull();
  });

  it("reaches the profession gate as the coworker's proposal", async () => {
    gate.mockClear();
    await finalizeArchitectureAdvisory({} as never, review("fail"), "user-1", "AGT-WS-EA", null, "reviewDesignDoc");
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate.mock.calls[0]![0]).toMatchObject({
      options: ["aligned", "revise-before-building"],
      proposedOptionId: "revise-before-building",
      domainClass: "architecture-tradeoff",
      caller: { agentId: "AGT-WS-EA" },
    });
  });

  it("records no proposal for an inconclusive review", async () => {
    gate.mockClear();
    await finalizeArchitectureAdvisory({} as never, review("inconclusive"), "user-1", null, null, "reviewPlanDoc");
    expect(gate.mock.calls[0]![0].proposedOptionId).toBeNull();
  });
});

describe("the advisory's subject (BI-22601A38)", () => {
  it("records the reviewed build, its backlog item, the phase and a digest of the reviewed document", async () => {
    gate.mockClear();
    const designDoc = { problemStatement: "one", proposedApproach: "reuse the ledger" };
    await finalizeArchitectureAdvisory({} as never, review("pass"), "user-1", "AGT-WS-EA", null, "reviewDesignDoc", {
      buildId: "FB-1",
      kind: "design",
      document: designDoc,
      backlogItemId: "BI-1",
    });
    expect(gate.mock.calls[0]![0]).toMatchObject({
      build: { buildId: "FB-1" },
      subject: { kind: "backlog_item", id: "BI-1" },
      phaseFrom: "ideate",
      phaseTo: "plan",
      outcomePayloadExtra: {
        reviewedArtifact: { buildId: "FB-1", kind: "design", digest: reviewedArtifactDigest(designDoc) },
      },
    });
  });

  it("names no backlog item when the build has none, rather than inventing one", async () => {
    gate.mockClear();
    await finalizeArchitectureAdvisory({} as never, review("fail"), "user-1", null, null, "reviewPlanDoc", {
      buildId: "FB-2",
      kind: "plan",
      document: { tasks: [] },
      backlogItemId: null,
    });
    const call = gate.mock.calls[0]![0];
    expect(call.subject).toBeNull();
    expect(call).toMatchObject({ build: { buildId: "FB-2" }, phaseFrom: "plan", phaseTo: "build" });
  });

  it("records no subject for a caller that does not say what was reviewed", async () => {
    gate.mockClear();
    await finalizeArchitectureAdvisory({} as never, review("pass"), "user-1", null, null, "reviewDesignDoc");
    const call = gate.mock.calls[0]![0];
    expect(call.build).toBeNull();
    expect(call.subject).toBeNull();
    expect(call.outcomePayloadExtra).toBeUndefined();
  });
});
