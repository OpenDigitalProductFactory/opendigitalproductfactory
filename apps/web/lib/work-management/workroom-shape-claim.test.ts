// Round-trip and tolerance tests for the Workroom shape claim (BI-E0BFFF77).

import { describe, expect, it } from "vitest";

import { buildWorkroomShapeClaim, readWorkroomShapeClaim } from "./workroom-shape-claim";

describe("workroom shape claim", () => {
  it("round-trips through the scopeClaims array form", () => {
    const claim = buildWorkroomShapeClaim("craft-stewardship", new Date("2026-08-16T00:00:00Z"));
    expect(claim).toEqual({
      workroomShape: "craft-stewardship",
      recordedAt: "2026-08-16T00:00:00.000Z",
    });
    const scopeClaims = [
      // Existing canonical ScopeClaim entries coexist untouched.
      {
        kind: "path", value: "apps/web/lib", intent: "edit",
        recordedAt: "2026-08-15T00:00:00.000Z", recordedByPrincipalId: "PRN-1",
      },
      claim,
    ];
    expect(readWorkroomShapeClaim(scopeClaims)).toBe("craft-stewardship");
  });

  it("reads the legacy object form", () => {
    expect(readWorkroomShapeClaim({ workroomShape: "outward-review" })).toBe("outward-review");
  });

  it("returns null for malformed or unknown claims without throwing", () => {
    expect(readWorkroomShapeClaim(null)).toBeNull();
    expect(readWorkroomShapeClaim(undefined)).toBeNull();
    expect(readWorkroomShapeClaim("outward-review")).toBeNull();
    expect(readWorkroomShapeClaim([])).toBeNull();
    expect(readWorkroomShapeClaim([{ workroomShape: "not-a-shape" }])).toBeNull();
    expect(readWorkroomShapeClaim([{ shape: "outward-review" }])).toBeNull();
    expect(readWorkroomShapeClaim({ workroomShape: 42 })).toBeNull();
  });

  it("returns the first valid declaration when several entries exist", () => {
    expect(
      readWorkroomShapeClaim([
        { workroomShape: "bogus" },
        { workroomShape: "specialist-alignment" },
        { workroomShape: "escalation" },
      ]),
    ).toBe("specialist-alignment");
  });
});
