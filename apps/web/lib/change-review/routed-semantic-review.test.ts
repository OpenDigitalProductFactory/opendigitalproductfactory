import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inference/routed-inference", () => ({
  routeAndCall: vi.fn(),
}));
vi.mock("@/lib/routing/local-provider-capacity", () => ({
  inspectLocalProviderCapacity: vi.fn(),
}));

import { routeAndCall } from "@/lib/inference/routed-inference";
import { inspectLocalProviderCapacity } from "@/lib/routing/local-provider-capacity";
import { dispatchRoutedSemanticReview } from "./routed-semantic-review";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({ available: true, reason: null });
});

describe("routed semantic review", () => {
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
