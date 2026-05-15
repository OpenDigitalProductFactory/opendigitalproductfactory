import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertEgressAllowlist,
  classifyReviewFailure,
  evaluateReviewerHealth,
  loadReviewSettings,
  validateAutonomousReviewDecisions,
} from "./bounded-autonomous-review";

const decisionSchema = z.object({
  id: z.string(),
  classification: z.enum(["keep", "reject"]),
});

describe("bounded autonomous review helpers", () => {
  it("classifies provider and routing failures into the shared taxonomy", () => {
    expect(classifyReviewFailure(new Error("request timed out"))).toBe("timeout");
    expect(classifyReviewFailure(new Error("provider rate limit exceeded"))).toBe("provider_rate_limit");
    expect(classifyReviewFailure(new Error("provider unavailable: 503"))).toBe("provider_unavailable");
    expect(classifyReviewFailure(new Error("router has no route"))).toBe("router_no_route");
    expect(classifyReviewFailure(new Error("budget exhausted"))).toBe("budget_exhausted");
    expect(classifyReviewFailure(new Error("invalid json parse"))).toBe("json_parse");
    expect(classifyReviewFailure(new Error("schema validation failed"))).toBe("schema_validation");
    expect(classifyReviewFailure(new Error("surprising thing"))).toBe("unknown");
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
      assertEgressAllowlist(
        { entries: [], existingSkillNames: [], extraSecret: "nope" },
        ["entries", "existingSkillNames"],
      ),
    ).toThrow(/extraSecret/);

    expect(() =>
      assertEgressAllowlist(
        { entries: [], existingSkillNames: [] },
        ["entries", "existingSkillNames"],
      ),
    ).not.toThrow();
  });

  it("loads settings from a namespaced platformConfig client with defaults", async () => {
    const settings = await loadReviewSettings({
      namespace: "example.review",
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

  it("loads default settings when platformConfig keys are missing", async () => {
    const settings = await loadReviewSettings({
      namespace: "example.review",
      platformConfig: {
        findUnique: async () => null,
      },
    });

    expect(settings).toMatchObject({
      enabled: true,
      cacheTtlDays: 30,
      minParseRate: 0.5,
      maxUnknownFailuresInWindow: 1,
      maxSingleClassFraction: 0.9,
      healthWindowSize: 5,
    });
  });

  it("auto-pauses on low parse-rate telemetry", () => {
    const status = evaluateReviewerHealth({
      history: Array.from({ length: 5 }, () => ({
        reviewParseSuccessRate: 0.25,
        reviewFailureReason: null,
        reviewClassificationHistogram: { reject: 2, keep: 2 },
      })),
    });

    expect(status).toEqual({ state: "auto_paused", trigger: "parse_rate" });
  });

  it("auto-pauses on repeated unknown failures", () => {
    const status = evaluateReviewerHealth({
      history: Array.from({ length: 2 }, () => ({
        reviewParseSuccessRate: 1,
        reviewFailureReason: "unknown",
        reviewClassificationHistogram: { reject: 1, keep: 1 },
      })),
    });

    expect(status).toEqual({ state: "auto_paused", trigger: "unknown_failures" });
  });

  it("auto-pauses on degenerate classification distribution", () => {
    const status = evaluateReviewerHealth({
      history: [
        {
          reviewParseSuccessRate: 1,
          reviewFailureReason: null,
          reviewClassificationHistogram: { reject: 9, keep: 1 },
        },
      ],
    });

    expect(status).toEqual({ state: "auto_paused", trigger: "degenerate_distribution" });
  });

  it("treats an empty health window as healthy", () => {
    const status = evaluateReviewerHealth({ history: [] });

    expect(status).toEqual({ state: "healthy" });
  });
});
