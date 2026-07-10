import { describe, it, expect } from "vitest";
import {
  buildBriefingContent,
  briefingSourceDigest,
  formatBriefingMessage,
  BRIEFING_MAX_FACTS,
  BRIEFING_CONTENT_CHAR_CAP,
  type BriefingSources,
} from "./coworker-briefing";

const base: BriefingSources = {
  subjectLabel: "dale@example.com",
  businessLine: null,
  topFacts: [],
  notes: [],
  recentDecisions: [],
  spendLine: null,
};

describe("buildBriefingContent", () => {
  it("returns null when there is no durable signal (strict no-op)", () => {
    expect(buildBriefingContent(base)).toBeNull();
  });

  it("renders facts, notes, and recent decisions under a header", () => {
    const out = buildBriefingContent({
      ...base,
      topFacts: [{ key: "cloud_provider", value: "AWS" }],
      notes: [{ noteKind: "preference", noteKey: "review_style", content: "bullets" }],
      recentDecisions: ["chose TDD for the billing module"],
    });
    expect(out).not.toBeNull();
    expect(out).toContain("BRIEFING — dale@example.com");
    expect(out).toContain("cloud_provider: AWS");
    expect(out).toContain("[preference] review_style: bullets");
    expect(out).toContain("chose TDD for the billing module");
  });

  it("renders a business line alone as sufficient signal", () => {
    const out = buildBriefingContent({ ...base, businessLine: "HVAC field service" });
    expect(out).toContain("Context: HVAC field service");
  });

  it("caps the number of facts", () => {
    const many = Array.from({ length: BRIEFING_MAX_FACTS + 5 }, (_, i) => ({
      key: `k${i}`,
      value: `v${i}`,
    }));
    const out = buildBriefingContent({ ...base, topFacts: many })!;
    const factLines = out.split("\n").filter((l) => l.startsWith("- k"));
    expect(factLines).toHaveLength(BRIEFING_MAX_FACTS);
  });

  it("caps overall content length", () => {
    const huge = Array.from({ length: 200 }, (_, i) => `decision ${i} ${"x".repeat(50)}`);
    const out = buildBriefingContent({ ...base, recentDecisions: huge })!;
    expect(out.length).toBeLessThanOrEqual(BRIEFING_CONTENT_CHAR_CAP);
  });
});

describe("briefingSourceDigest", () => {
  it("is stable for identical inputs", () => {
    const s: BriefingSources = { ...base, topFacts: [{ key: "a", value: "1" }] };
    expect(briefingSourceDigest(s)).toBe(briefingSourceDigest({ ...s }));
  });

  it("changes when a fact value changes", () => {
    const a = briefingSourceDigest({ ...base, topFacts: [{ key: "a", value: "1" }] });
    const b = briefingSourceDigest({ ...base, topFacts: [{ key: "a", value: "2" }] });
    expect(a).not.toBe(b);
  });
});

describe("formatBriefingMessage", () => {
  it("returns null for empty content", () => {
    expect(formatBriefingMessage(null)).toBeNull();
    expect(formatBriefingMessage(undefined)).toBeNull();
    expect(formatBriefingMessage("")).toBeNull();
  });

  it("wraps content as a user-role session-briefing message", () => {
    const m = formatBriefingMessage("BRIEFING — x");
    expect(m).not.toBeNull();
    expect(m!.role).toBe("user");
    expect(m!.content).toContain("SESSION BRIEFING");
    expect(m!.content).toContain("BRIEFING — x");
  });
});
