import { describe, expect, it } from "vitest";

import {
  COMPLETENESS_OFFER_THRESHOLD,
  scoreAccountCompleteness,
  scoreContactCompleteness,
} from "./completeness";

describe("completeness / gap detection (AC1)", () => {
  it("flags a name-only prospect as below threshold (the worked-example shape)", () => {
    const result = scoreAccountCompleteness({ name: "TeamLogic IT" });
    expect(result.belowThreshold).toBe(true);
    expect(result.missing).toContain("website");
    expect(result.missing).toContain("industry");
    expect(result.filled).toEqual(["name"]);
  });

  it("does NOT nag a name+website account (exactly at threshold — matches the docstring)", () => {
    const result = scoreAccountCompleteness({ name: "TeamLogic IT", website: "https://teamlogicit.com" });
    expect(result.score).toBe(0.5);
    expect(result.belowThreshold).toBe(false);
  });

  it("does NOT nag a well-filled account", () => {
    const result = scoreAccountCompleteness({
      name: "TeamLogic IT of Round Rock",
      website: "https://teamlogicit.com/rrtx",
      industry: "Managed IT Services",
      employeeCount: 12,
      location: "Round Rock, TX",
      notes: "MSP serving north Austin metro",
    });
    expect(result.belowThreshold).toBe(false);
    expect(result.missing).toHaveLength(0);
    expect(result.score).toBe(1);
  });

  it("treats blank/whitespace/zero as unfilled", () => {
    const result = scoreAccountCompleteness({
      name: "  ",
      website: "",
      employeeCount: 0,
    });
    expect(result.filled).toHaveLength(0);
    expect(result.score).toBe(0);
  });

  it("derives location from city/region aliases", () => {
    const filled = scoreAccountCompleteness({ name: "X", city: "Austin" });
    expect(filled.filled).toContain("location");
  });

  it("scores a contact and flags a name-only contact", () => {
    const result = scoreContactCompleteness({ firstName: "Greg" });
    expect(result.recordKind).toBe("customer-contact");
    expect(result.belowThreshold).toBe(true);
    expect(result.missing).toContain("jobTitle");
    expect(result.missing).toContain("linkedinUrl");
  });

  it("threshold is a fraction in (0,1)", () => {
    expect(COMPLETENESS_OFFER_THRESHOLD).toBeGreaterThan(0);
    expect(COMPLETENESS_OFFER_THRESHOLD).toBeLessThan(1);
  });
});
