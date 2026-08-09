import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inference/routed-inference", () => ({
  routeAndCall: vi.fn(),
}));
vi.mock("@/lib/nonprod/environment-lease", () => ({
  listActiveNonprodEnvironmentLeases: vi.fn(),
}));

import { routeAndCall } from "@/lib/inference/routed-inference";
import { listActiveNonprodEnvironmentLeases } from "@/lib/nonprod/environment-lease";
import { dispatchRoutedSemanticReview } from "./routed-semantic-review";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listActiveNonprodEnvironmentLeases).mockResolvedValue([] as never);
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

  it("defers review while local CI owns host capacity", async () => {
    vi.mocked(listActiveNonprodEnvironmentLeases).mockResolvedValue([
      { environmentKey: "local-integration-ci" },
    ] as never);

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: ["AGT-181"],
      surface: "external",
    });

    expect(result).toEqual({
      decision: "inconclusive",
      issues: [],
      summary: "Semantic review deferred while governed local CI owns host capacity.",
      inconclusiveReason: "local-ci-active-capacity-reservation",
    });
    expect(routeAndCall).not.toHaveBeenCalled();
  });

  it("fails closed when the host-capacity registry cannot be read", async () => {
    vi.mocked(listActiveNonprodEnvironmentLeases).mockRejectedValue(new Error("registry unavailable"));

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: [],
      surface: "external",
    });

    expect(result.decision).toBe("inconclusive");
    expect(result.inconclusiveReason).toBe("local-ci-capacity-reservation-unavailable");
    expect(routeAndCall).not.toHaveBeenCalled();
  });

  it("does not defer review for an unrelated nonproduction lease", async () => {
    vi.mocked(listActiveNonprodEnvironmentLeases).mockResolvedValue([
      { environmentKey: "dev-portal" },
    ] as never);
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
