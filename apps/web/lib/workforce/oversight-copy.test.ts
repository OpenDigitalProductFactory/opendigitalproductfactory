import { describe, expect, it } from "vitest";
import {
  OVERSIGHT_COPY,
  OVERSIGHT_TIERS_ASC,
  getOversightCopy,
  isOversightTier,
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
      const { fg, border, softBg } = oversightStyle(tier);
      for (const value of [fg, border, softBg]) {
        expect(value).toContain("var(--dpf-");
        expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      }
    }
    // Distinct intents per tier, so the four rows stay visually separable.
    const intents = OVERSIGHT_TIERS_ASC.map((c) => c.intent);
    expect(new Set(intents).size).toBe(4);
  });

  it("falls back to the muted token and a neutral style for an unmapped tier", () => {
    expect(oversightStyle(7).fg).toBe("var(--dpf-muted)");
    expect(oversightStyle(null).fg).toBe("var(--dpf-muted)");
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

  // Dense surfaces (matrix cells, per-row badges) previously showed a bare tier
  // NUMBER — one word, and meaningless. The dense token has to carry meaning at
  // that same one-word cost or the UX route word budget regresses: rendering
  // "Employee review" in every row of /platform/audit/authority grew that page
  // by 184 words and failed the ratchet.
  it("keeps the dense token to a single word so the route word budget holds", () => {
    for (const tier of [0, 1, 2, 3]) {
      const dense = oversightLabel(tier, { dense: true });
      expect(dense.trim().split(/\s+/)).toHaveLength(1);
      expect(dense.toLowerCase()).not.toContain("hitl");
      expect(dense.toLowerCase()).not.toContain("human");
      // Still a word, not a digit dressed up as one.
      expect(dense).not.toMatch(/^\d+$/);
    }
  });

  it("maps each tier to a distinct dense token", () => {
    const dense = [0, 1, 2, 3].map((t) => oversightLabel(t, { dense: true }));
    expect(dense).toEqual(["Manual", "Approve", "Review", "Auto"]);
    expect(new Set(dense).size).toBe(4);
  });

  it("prefers dense over short when both are passed, and still falls back", () => {
    expect(oversightLabel(2, { dense: true, short: true })).toBe("Review");
    expect(oversightLabel(9, { dense: true })).toBe("Not set");
    expect(oversightLabel(9, { dense: true, fallback: "—" })).toBe("—");
  });
});
