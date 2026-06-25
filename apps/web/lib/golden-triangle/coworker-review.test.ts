import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import {
  buildDeliberationPrompt,
  buildReviewerUserPrompt,
  DEBATER_SYSTEM_PROMPT,
  interpretReviewVerdict,
  resolveCoworkerReviewPattern,
  REVIEW_APPROVED,
  REVIEWER_SYSTEM_PROMPT,
} from "./coworker-review";
import type { GoldenTrianglePersistenceClient } from "./persistence";

function client(perAgent: Record<string, GoldenTrianglePreference>): GoldenTrianglePersistenceClient {
  return {
    decisionPerspectiveProfile: {
      findFirst: async () => ({ autonomyPolicy: { goldenTrianglePerAgent: perAgent } }),
      updateMany: async () => ({ count: 0 }),
    },
  };
}

const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };
const EXTREME: GoldenTrianglePreference = { preset: "custom", qualityWeight: 0.9, costWeight: 0.05, timeWeight: 0.05 };
const FRUGAL: GoldenTrianglePreference = { preset: "frugal", qualityWeight: 0.1, costWeight: 0.8, timeWeight: 0.1 };

describe("resolveCoworkerReviewPattern", () => {
  it("returns review for an Assured coworker", async () => {
    expect(await resolveCoworkerReviewPattern("a", client({ a: ASSURED }))).toBe("review");
  });
  it("returns debate for an extreme-quality coworker", async () => {
    expect(await resolveCoworkerReviewPattern("a", client({ a: EXTREME }))).toBe("debate");
  });
  it("returns none for a frugal coworker", async () => {
    expect(await resolveCoworkerReviewPattern("a", client({ a: FRUGAL }))).toBe("none");
  });
  it("returns none when the coworker has no posture", async () => {
    expect(await resolveCoworkerReviewPattern("a", client({}))).toBe("none");
  });
});

describe("interpretReviewVerdict", () => {
  const draft = "The answer is 42.";
  it("keeps the draft on APPROVED (tolerating case/punctuation)", () => {
    expect(interpretReviewVerdict(draft, REVIEW_APPROVED)).toEqual({ content: draft, revised: false });
    expect(interpretReviewVerdict(draft, "Approved.")).toEqual({ content: draft, revised: false });
  });
  it("keeps the draft on an empty/blank verdict", () => {
    expect(interpretReviewVerdict(draft, "")).toEqual({ content: draft, revised: false });
    expect(interpretReviewVerdict(draft, null)).toEqual({ content: draft, revised: false });
  });
  it("uses the reviewer text when it actually revises", () => {
    const better = "The answer is 42, per Hitchhiker's Guide.";
    expect(interpretReviewVerdict(draft, better)).toEqual({ content: better, revised: true });
  });
  it("treats an identical revision as no change", () => {
    expect(interpretReviewVerdict(draft, "The answer is 42.")).toEqual({ content: draft, revised: false });
  });
});

describe("buildReviewerUserPrompt", () => {
  it("includes the request and the draft", () => {
    const p = buildReviewerUserPrompt("what is 6x7?", "42");
    expect(p).toContain("what is 6x7?");
    expect(p).toContain("42");
  });
});

describe("buildDeliberationPrompt", () => {
  it("uses the reviewer prompts for the review pattern", () => {
    const { system, user } = buildDeliberationPrompt("review", "q", "draft");
    expect(system).toBe(REVIEWER_SYSTEM_PROMPT);
    expect(user).toContain("draft");
  });
  it("uses the debater prompts for the debate pattern", () => {
    const { system, user } = buildDeliberationPrompt("debate", "q", "draft");
    expect(system).toBe(DEBATER_SYSTEM_PROMPT);
    expect(system).toMatch(/debate/i);
    expect(user).toMatch(/for vs\.? against|Debate it/i);
    expect(user).toContain("draft");
  });
});
