import { describe, expect, it } from "vitest";

import {
  intentStyle,
  resolveIntent,
  STATUS_INTENT,
  type Intent,
} from "./statusColors";

const ALL_INTENTS: Intent[] = [
  "success",
  "warning",
  "danger",
  "info",
  "neutral",
  "accent",
];

describe("statusColors", () => {
  it("maps every intent to --dpf-* tokens (no raw hex)", () => {
    for (const intent of ALL_INTENTS) {
      const style = intentStyle(intent);
      expect(style.fg).toMatch(/var\(--dpf-/);
      expect(style.border).toMatch(/var\(--dpf-/);
      expect(style.fg).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  it("derives soft backgrounds via color-mix for non-neutral intents", () => {
    expect(intentStyle("success").softBg).toContain("color-mix");
    // neutral uses a surface token, not a tint
    expect(intentStyle("neutral").softBg).toBe("var(--dpf-surface-2)");
  });

  it("every registered status resolves to a valid intent", () => {
    for (const [domain, map] of Object.entries(STATUS_INTENT)) {
      for (const status of Object.keys(map)) {
        expect(ALL_INTENTS).toContain(resolveIntent(domain, status));
      }
    }
  });

  it("falls back to neutral for unknown domain or status", () => {
    expect(resolveIntent("nope", "whatever")).toBe("neutral");
    expect(resolveIntent("finance", "not-a-status")).toBe("neutral");
  });

  it("maps known finance + complaint statuses to expected intents", () => {
    expect(resolveIntent("finance", "overdue")).toBe("danger");
    expect(resolveIntent("finance", "paid")).toBe("success");
    expect(resolveIntent("complaintSeverity", "critical")).toBe("danger");
    expect(resolveIntent("complaintStatus", "resolved")).toBe("success");
  });
});
