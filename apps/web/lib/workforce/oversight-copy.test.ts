import { describe, expect, it } from "vitest";
import {
  OVERSIGHT_COPY,
  OVERSIGHT_TIERS_ASC,
  getOversightCopy,
  isOversightTier,
  oversightColour,
  oversightLabel,
  oversightStyle,
} from "./oversight-copy";

describe("oversight copy (BI-F2EC4699)", () => {
  it("maps every stored tier 0..3 to copy", () => {
    for (const tier of [0, 1, 2, 3]) {
      expect(getOversightCopy(tier)).not.toBeNull();
      expect(getOversightCopy(tier)?.tier).toBe(tier);
    }
  });

  it("returns null for an unmapped, missing, or non-integer tier", () => {
    expect(getOversightCopy(4)).toBeNull();
    expect(getOversightCopy(-1)).toBeNull();
    expect(getOversightCopy(null)).toBeNull();
    expect(getOversightCopy(undefined)).toBeNull();
    expect(getOversightCopy(1.5)).toBeNull();
    expect(isOversightTier(2)).toBe(true);
    expect(isOversightTier(9)).toBe(false);
  });

  // The whole point of the module: a non-technical reader never meets the
  // acronym or the bare word "human" in a rendered label.
  it("never renders the HITL acronym or the word human in user-facing copy", () => {
    for (const copy of OVERSIGHT_TIERS_ASC) {
      const surfaces = [copy.label, copy.shortLabel, copy.description, copy.ariaLabel];
      for (const text of surfaces) {
        expect(text.toLowerCase()).not.toContain("hitl");
        expect(text.toLowerCase()).not.toContain("human");
        expect(text.toLowerCase()).not.toContain("tier ");
      }
    }
  });

  it("names the employee as the role that supervises the work", () => {
    expect(OVERSIGHT_COPY["employee-only"].label).toBe("Employee only");
    expect(OVERSIGHT_COPY["employee-review"].label).toBe("Employee review");
    // Tier 1 and 3 describe the action, and still say who approves.
    expect(OVERSIGHT_COPY["needs-approval"].description).toContain("employee");
    expect(OVERSIGHT_COPY["on-its-own"].ariaLabel).toContain("employee");
  });

  it("orders tiers from least to most coworker autonomy", () => {
    expect(OVERSIGHT_TIERS_ASC.map((c) => c.tier)).toEqual([0, 1, 2, 3]);
    expect(OVERSIGHT_TIERS_ASC.map((c) => c.slug)).toEqual([
      "employee-only",
      "needs-approval",
      "employee-review",
      "on-its-own",
    ]);
  });

  // AGENTS.md §12: colour resolves through report-kit tokens, never raw hex.
  // The six inline maps this module replaced had drifted, two with raw hex.
  it("resolves every tier colour to a --dpf-* token and never raw hex", () => {
    for (const tier of [0, 1, 2, 3]) {
      const colour = oversightColour(tier);
      expect(colour).toContain("var(--dpf-");
      expect(colour).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
    // Distinct intents per tier, so the four rows stay visually separable.
    const intents = OVERSIGHT_TIERS_ASC.map((c) => c.intent);
    expect(new Set(intents).size).toBe(4);
  });

  it("falls back to the muted token and a neutral style for an unmapped tier", () => {
    expect(oversightColour(7)).toBe("var(--dpf-muted)");
    expect(oversightColour(null)).toBe("var(--dpf-muted)");
    expect(oversightStyle(7).fg).toBe("var(--dpf-muted)");
  });

  it("labels an unmapped tier without fabricating a governance posture", () => {
    expect(oversightLabel(null)).toBe("Not set");
    expect(oversightLabel(4)).toBe("Not set");
    expect(oversightLabel(null, { fallback: "—" })).toBe("—");
  });

  it("offers a compact label for chips and dense cells", () => {
    expect(oversightLabel(2)).toBe("Employee review");
    expect(oversightLabel(2, { short: true })).toBe("Reviewed");
    expect(oversightLabel(3, { short: true })).toBe("On its own");
  });
});
