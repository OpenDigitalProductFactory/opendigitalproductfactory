import { describe, expect, it } from "vitest";

import {
  buildRescueCockpit,
  parseRescueFilter,
  sourceAvailable,
  sourceUnavailable,
} from "./cockpit";

describe("Pet Rescue cockpit projection", () => {
  it("keeps unavailable source state distinct from an honest zero", () => {
    const cockpit = buildRescueCockpit({
      animals: sourceAvailable({ inCare: 12, intakeReview: 2, legalHold: 1, placementReady: 4 }),
      capacity: sourceUnavailable("capacity service unavailable"),
      care: sourceAvailable({ dueToday: 8, missed: 1, exceptions: 2 }),
      adoptions: sourceAvailable({ activeApplications: 5, readyWithoutInterest: 1 }),
      stewardship: sourceUnavailable("finance permission required"),
    });

    expect(cockpit.sources.capacity.state).toBe("unavailable");
    expect(cockpit.sources.capacity.data).toBeNull();
    expect(cockpit.attention[0]?.href).toBe("/workspace/rescue/care?filter=missed");
    expect(cockpit.attention.every((item) => item.href.startsWith("/workspace/rescue/"))).toBe(true);
  });
});

describe("Pet Rescue route filters", () => {
  it("accepts only filters supported by the current operating area", () => {
    expect(parseRescueFilter("care", "missed")).toBe("missed");
    expect(parseRescueFilter("intake", "legal-hold")).toBe("legal-hold");
    expect(parseRescueFilter("adoptions", "no-interest")).toBe("no-interest");
    expect(parseRescueFilter("animals", "legal-hold")).toBe("all");
    expect(parseRescueFilter("animals", "missed")).toBe("all");
    expect(parseRescueFilter("care", "not-a-real-filter")).toBe("all");
    expect(parseRescueFilter("care", ["missed", "legal-hold"])).toBe("all");
    expect(parseRescueFilter("overview", undefined)).toBe("all");
  });
});
