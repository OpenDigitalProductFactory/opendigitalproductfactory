import { describe, expect, it, vi } from "vitest";

const { gate } = vi.hoisted(() => ({ gate: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/decision-perspective/profession-gate", () => ({ evaluateProfessionDecisionGate: gate }));
vi.mock("@/lib/process-spine/canonical-improvement-digest", () => ({
  promoteReferenceDocFindings: vi.fn().mockResolvedValue(undefined),
}));

import type { ReviewResult } from "@/lib/explore/feature-build-types";

import { architectProposedOption, finalizeArchitectureAdvisory } from "./architecture-advisory-ledger";

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
