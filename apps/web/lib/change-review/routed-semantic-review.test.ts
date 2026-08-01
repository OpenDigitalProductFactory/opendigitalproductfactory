import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inference/routed-inference", () => ({ routeAndCall: vi.fn() }));

import { routeAndCall } from "@/lib/inference/routed-inference";
import { dispatchRoutedSemanticReview } from "./routed-semantic-review";

beforeEach(() => vi.clearAllMocks());

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

  it("fails closed when any required review branch does not complete", async () => {
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

    expect(result.decision).toBe("fail");
    expect(result.parseError).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "critical" }));
  });
});
