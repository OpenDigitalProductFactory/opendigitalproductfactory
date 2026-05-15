import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertReviewInputAllowlist,
  classifyAutonomousReviewFailure,
  evaluateAutonomousReviewerHealth,
  loadAutonomousReviewSettings,
  validateAutonomousReviewDecisions,
} from "./bounded-autonomous-review";

const decisionSchema = z.object({
  id: z.string(),
  classification: z.enum(["keep", "reject"]),
});

describe("bounded autonomous review helpers", () => {
  it("classifies provider and routing failures into the shared taxonomy", () => {
    expect(classifyAutonomousReviewFailure(new Error("request timed out"))).toBe("timeout");
    expect(classifyAutonomousReviewFailure(new Error("provider rate limit exceeded"))).toBe("provider_rate_limit");
    expect(classifyAutonomousReviewFailure(new Error("router has no route"))).toBe("router_no_route");
    expect(classifyAutonomousReviewFailure(new Error("budget exhausted"))).toBe("budget_exhausted");
    expect(classifyAutonomousReviewFailure(new Error("surprising thing"))).toBe("unknown");
  });

  it("validates reviewer decisions and counts schema drops", () => {
    const result = validateAutonomousReviewDecisions(decisionSchema, [
      { id: "a", classification: "keep" },
      { id: "b", classification: "invented" },
      null,
    ]);

    expect(result.decisions).toEqual([{ id: "a", classification: "keep" }]);
    expect(result.dropped).toBe(2);
    expect(result.parseSuccessRate(3)).toBe(1 / 3);
  });

  it("enforces top-level egress allowlists", () => {
    expect(() =>
      assertReviewInputAllowlist(
        { entries: [], existingSkillNames: [], extraSecret: "nope" },
        ["entries", "existingSkillNames"],
      ),
    ).toThrow(/extraSecret/);

    expect(() =>
      assertReviewInputAllowlist(
        { entries: [], existingSkillNames: [] },
        ["entries", "existingSkillNames"],
      ),
    ).not.toThrow();
  });

  it("loads settings from a namespaced PlatformConfig client with defaults", async () => {
    const settings = await loadAutonomousReviewSettings({
      settingPrefix: "example.review",
      platformConfig: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          where.key === "example.review.enabled"
            ? { value: "false" }
            : where.key === "example.review.cacheTtlDays"
              ? { value: "14" }
              : null,
      },
    });

    expect(settings.enabled).toBe(false);
    expect(settings.cacheTtlDays).toBe(14);
    expect(settings.healthWindowSize).toBe(5);
  });

  it("auto-pauses on unhealthy recent TaskRun reviewer metrics", async () => {
    const status = await evaluateAutonomousReviewerHealth({
      agentId: "test-agent",
      taskRun: {
        findMany: async () =>
          Array.from({ length: 5 }, () => ({
            progressPayload: {
              scheduledSummaryPayload: {
                metrics: {
                  reviewParseSuccessRate: 0.25,
                  reviewFailureReason: null,
                  reviewClassificationHistogram: { reject: 2, keep: 2 },
                },
              },
            },
          })),
      },
    });

    expect(status).toBe("auto_pause_parse_rate");
  });
});
