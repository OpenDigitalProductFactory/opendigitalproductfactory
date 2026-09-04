// Owner-facing decision copy (BI-0AA9B679).
//
// The owner cockpit renders one of these headlines on every attention card, so
// they are among the most-read strings in the product. Four of them used to read
// "Choose what happens to this build?" / "Choose how to fix this for customers?"
// — an imperative closed with a question mark, which is not a grammatical
// question. Observed live on /workspace 2026-08-19.
//
// The other entries are fine because they are elliptical questions ("Approve
// this bill?" = "[Do you want to] approve this bill?"). The distinction this
// file pins is narrow: a headline may be an elliptical question, but it may not
// be an imperative wearing a question mark.

import { describe, expect, it } from "vitest";

import { headlineFor } from "./owner-decision-copy";
import type { AttentionItem, AttentionSource } from "./types";

const ALL_SOURCES: AttentionSource[] = [
  "escalation",
  "ai-decision",
  "paused-ai",
  "scheduled-task",
  "agent-proposal",
  "approval-outbound",
  "approval-bill",
  "approval-expense",
  "compliance-submission",
  "research-proposal",
  "coworker-memory",
  "ai-readiness-blocker",
  "platform-health",
  "provider-credential",
  "reservation-exception",
  "hospitality-capacity",
  "storefront-inquiry",
  "business-journey",
  "compliance-source-freshness",
  "coworker-envelope",
  "skill-proposal",
];

/**
 * headlineFor() branches on `title` for two sources, so the probe title must not
 * trip those branches — a neutral title exercises the HEADLINE table itself.
 */
function headline(source: AttentionSource): string {
  return headlineFor({ source, title: "Neutral probe title" } as AttentionItem);
}

const IMPERATIVE_OPENERS = ["choose", "pick", "select", "decide"];

describe("owner decision headlines", () => {
  it("returns a non-empty headline for every attention source", () => {
    for (const source of ALL_SOURCES) {
      const text = headline(source);
      expect(text, `${source} must have a headline`).toBeTruthy();
      expect(text.trim().length, `${source} headline must not be blank`).toBeGreaterThan(0);
    }
  });

  it("never phrases a headline as an imperative closed with a question mark (BI-0AA9B679)", () => {
    for (const source of ALL_SOURCES) {
      const text = headline(source);
      if (!text.trim().endsWith("?")) continue;
      const firstWord = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
      expect(
        IMPERATIVE_OPENERS,
        `"${text}" (${source}) opens with an imperative but ends in "?" — `
        + "rephrase as a question, e.g. \"How should we …?\"",
      ).not.toContain(firstWord);
    }
  });

  it("keeps the four repaired headlines readable as questions", () => {
    expect(headline("escalation")).toBe("What should happen to this build?");
    expect(headline("ai-readiness-blocker")).toBe("How should we fix your intelligence setup?");
    expect(headline("platform-health")).toBe("How should we handle this outage?");
    expect(headline("business-journey")).toBe("How should we fix this for customers?");
  });

  it("leaves the elliptical-question headlines untouched", () => {
    // These were never broken; pinning them keeps the fix from over-reaching.
    expect(headline("approval-bill")).toBe("Approve this bill?");
    expect(headline("approval-outbound")).toBe("Send this message?");
  });

  it("keeps every headline short enough for the cockpit card", () => {
    for (const source of ALL_SOURCES) {
      expect(
        headline(source).length,
        `${source} headline is long enough to wrap the card`,
      ).toBeLessThanOrEqual(60);
    }
  });
});
