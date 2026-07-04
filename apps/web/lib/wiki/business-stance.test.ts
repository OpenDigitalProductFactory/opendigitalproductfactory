import { describe, it, expect } from "vitest";

import {
  buildStanceSlug,
  validateBusinessStance,
  BUSINESS_STANCE_SLUG_PREFIX,
} from "./business-stance";

describe("buildStanceSlug", () => {
  it("derives a kernel-style slug under the stances prefix", () => {
    expect(buildStanceSlug("How we decide refunds")).toBe(
      "stances/how-we-decide-refunds",
    );
  });

  it("strips punctuation and collapses whitespace/dashes", () => {
    expect(buildStanceSlug("  Refunds & credits — how?? ")).toBe(
      "stances/refunds-credits-how",
    );
  });

  it("falls back to 'untitled' when nothing survives normalization", () => {
    expect(buildStanceSlug("!!!")).toBe(`${BUSINESS_STANCE_SLUG_PREFIX}/untitled`);
  });
});

describe("validateBusinessStance", () => {
  it("accepts a well-formed stance and normalizes fields", () => {
    const result = validateBusinessStance({
      title: "  How we decide refunds  ",
      body: "  We refund within 30 days, no questions asked.  ",
      summary: "  30-day refunds  ",
    });
    expect(result).toEqual({
      ok: true,
      slug: "stances/how-we-decide-refunds",
      title: "How we decide refunds",
      body: "We refund within 30 days, no questions asked.",
      summary: "30-day refunds",
    });
  });

  it("nulls an empty summary", () => {
    const result = validateBusinessStance({
      title: "Vendor selection",
      body: "We prefer incumbents unless price differs by 15%+.",
      summary: "   ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toBeNull();
  });

  it("rejects a too-short title", () => {
    const result = validateBusinessStance({ title: "no", body: "some body text here" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/title/i);
  });

  it("rejects a too-short body", () => {
    const result = validateBusinessStance({ title: "Refund policy", body: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/how your business decides/i);
  });
});
