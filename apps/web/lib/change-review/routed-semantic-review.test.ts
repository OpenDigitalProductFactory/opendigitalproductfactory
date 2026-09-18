import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inference/routed-inference", () => ({
  routeAndCall: vi.fn(),
}));
vi.mock("@/lib/routing/local-provider-capacity", () => ({
  inspectLocalProviderCapacity: vi.fn(),
}));

import { routeAndCall } from "@/lib/inference/routed-inference";
import { buildEffectiveRequestContract, buildInitialRouteContext } from "@/lib/inference/route-contract-builder";
import { inspectLocalProviderCapacity } from "@/lib/routing/local-provider-capacity";
import { dispatchRoutedSemanticReview } from "./routed-semantic-review";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({ available: true, reason: null });
});

describe("routed semantic review", () => {
  it("requests completed non-streaming results for the reviewer and every specialist", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Completed review." }),
    } as never);
    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer",
      specialistIds: ["AGT-903", "AGT-902", "AGT-131", "AGT-181"], surface: "external",
    });
    expect(result.decision).toBe("pass");
    expect(routeAndCall).toHaveBeenCalledTimes(5);
    for (const [messages, , sensitivity, options] of vi.mocked(routeAndCall).mock.calls) {
      if (sensitivity === undefined) throw new Error("Reviewer sensitivity must be explicit.");
      expect(options).toMatchObject({ interactionMode: "sync", requiresStreaming: false });
      const routeContext = buildInitialRouteContext({ sensitivity, options,
        posture: null, localOnlyInference: false });
      const contract = await buildEffectiveRequestContract({ taskType: "build-review",
        messages, tools: undefined, routeContext, options, taskRequirement: null });
      expect(contract).toMatchObject({ interactionMode: "sync", requiresStreaming: false });
    }
  });

  it("reuses a checkpointed reviewer branch and dispatches only the missing specialist", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Specialist pass." }) } as never);
    const checkpoint = vi.fn(async (id: string, execute: () => Promise<unknown>) => id === "change-reviewer"
      ? { decision: "pass", issues: [], summary: "Verified stored branch." } : execute());
    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: ["AGT-903"], surface: "external",
    }, checkpoint as never);
    expect(result.decision).toBe("pass");
    expect(checkpoint.mock.calls.map(([id]) => id)).toEqual(["change-reviewer", "AGT-903"]);
    expect(routeAndCall).toHaveBeenCalledOnce();
    expect(vi.mocked(routeAndCall).mock.calls[0]![3]).toMatchObject({ agentId: "AGT-903" });
  });

  it("reports an unsupported required specialist instead of silently claiming completion", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }) } as never);
    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: ["AGT-UNKNOWN"], surface: "external",
    });
    expect(result.decision).toBe("inconclusive");
    expect(result.inconclusiveReason).toContain("unsupported-required-specialist");
    expect(routeAndCall).not.toHaveBeenCalled();
  });

  it("runs the Change Reviewer and requested specialist as independent branches", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
    } as never);

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: ["AGT-903"],
      surface: "external",
    });

    expect(routeAndCall).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(routeAndCall).mock.calls) {
      expect(call[2]).toBe("internal");
    }
    expect(result.decision).toBe("pass");
  });

  it("classifies an incomplete required branch as infrastructure-inconclusive", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce({
        content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
      } as never)
      .mockRejectedValueOnce(new Error("specialist unavailable"));

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: ["AGT-903"],
      surface: "build-studio",
    });

    expect(result.decision).toBe("inconclusive");
    expect(result.inconclusiveReason).toContain("review-branch-capacity-or-transport-failure");
    expect(result.issues).toEqual([]);
  });

  it.each([
    "local-ci-active-capacity-reservation",
    "local-ci-queued-capacity-reservation",
    "local-ci-capacity-reservation-unavailable",
  ] as const)("allows eligible remote review despite %s", async (reason) => {
    vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({
      available: false,
      reason,
    });
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
    } as never);

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: ["AGT-181"],
      surface: "external",
    });

    expect(result.decision).toBe("pass");
    expect(routeAndCall).toHaveBeenCalledTimes(2);
    expect(inspectLocalProviderCapacity).not.toHaveBeenCalled();
  });

  it("does not defer review for an unrelated nonproduction lease", async () => {
    vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({ available: true, reason: null });
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
    } as never);

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: [],
      surface: "external",
    });

    expect(result.decision).toBe("pass");
    expect(routeAndCall).toHaveBeenCalledOnce();
  });
});
