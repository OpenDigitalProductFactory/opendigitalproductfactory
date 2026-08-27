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
    vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({
      available: false,
      reason: "local-ci-active-capacity-reservation",
    });

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
    vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({
      available: false,
      reason: "local-ci-capacity-reservation-unavailable",
    });

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

  it("defers review so an established local-CI queue can take the next safe window", async () => {
    vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({
      available: false,
      reason: "local-ci-queued-capacity-reservation",
    });

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: [],
      surface: "external",
    });

    expect(result).toEqual({
      decision: "inconclusive",
      issues: [],
      summary: "Semantic review deferred so the established local-CI queue can claim the next safe host window.",
      inconclusiveReason: "local-ci-queued-capacity-reservation",
    });
    expect(routeAndCall).not.toHaveBeenCalled();
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

  it("describes a prompt-only review without inventing a tool-use requirement", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
    } as never);

    await dispatchRoutedSemanticReview("review this bounded change", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: [],
      surface: "external",
    });

    const options = vi.mocked(routeAndCall).mock.calls[0]![3];
    expect(options?.minimumCapabilities).toBeUndefined();
    expect(options?.agentMinimumContextTokens).toBeGreaterThan(4_000);
    expect(options?.agentMinimumContextTokens).toBeLessThan(24_576);
    expect(options).not.toHaveProperty("preferredProviderId");
    expect(options).not.toHaveProperty("preferredModelId");
  });

  it("keeps an oversized review packet above the 24,576-token endpoint floor", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
    } as never);

    await dispatchRoutedSemanticReview("x".repeat(100_000), {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: [],
      surface: "external",
    });

    const options = vi.mocked(routeAndCall).mock.calls[0]![3];
    expect(options?.agentMinimumContextTokens).toBeGreaterThan(24_576);
  });
});
