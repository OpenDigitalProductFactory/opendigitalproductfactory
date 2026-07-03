// apps/web/lib/tak/initiative-block.test.ts
// BI-E35A8AA4: the Proactivity level must produce a materially different
// initiative directive, and the assertive level must NOT read as license to
// fabricate or overreach.

import { describe, expect, it } from "vitest";
import { buildInitiativeBlock } from "./initiative-block";

describe("buildInitiativeBlock", () => {
  it("returns a distinct, non-empty directive per level", () => {
    const quiet = buildInitiativeBlock("quiet");
    const balanced = buildInitiativeBlock("balanced");
    const assertive = buildInitiativeBlock("assertive");
    for (const b of [quiet, balanced, assertive]) {
      expect(b.length).toBeGreaterThan(0);
      expect(b).toMatch(/INITIATIVE/);
    }
    expect(new Set([quiet, balanced, assertive]).size).toBe(3);
  });

  it("null / undefined resolves to the balanced default (the dock's effective level)", () => {
    expect(buildInitiativeBlock(null)).toBe(buildInitiativeBlock("balanced"));
    expect(buildInitiativeBlock(undefined)).toBe(buildInitiativeBlock("balanced"));
  });

  it("quiet tells the coworker to do-and-stop, not chase", () => {
    const quiet = buildInitiativeBlock("quiet").toLowerCase();
    expect(quiet).toMatch(/stop|do not chase|let the employee/);
  });

  it("assertive tells it to close the gap with its own tools before asking", () => {
    const a = buildInitiativeBlock("assertive").toLowerCase();
    expect(a).toMatch(/exhaust|close the gap|research/);
    expect(a).toMatch(/only for what you genuinely could not/);
  });

  it("assertive re-states the bounds so higher effort is not read as license to overreach", () => {
    const a = buildInitiativeBlock("assertive").toLowerCase();
    // must NOT invite fabrication or authority-widening
    expect(a).toMatch(/never invent|never fabricate|not your authority|effort, not/);
    expect(a).toMatch(/exceed|authority|external|customer/);
  });
});
