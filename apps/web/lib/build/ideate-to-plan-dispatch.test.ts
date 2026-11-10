// BI-8823E12A (live, 2026-09-24): FB-1FAAA146 self-repaired its fix
// diagnosis and advanced ideate → plan at 13:31:46, then sat idle for 26
// minutes until the stranded-build sweep resumed it at 13:58. The fix-review
// path in reviewDesignDoc advanced the phase but, unlike the feature path,
// never dispatched plan generation. Every advance to plan must hand off.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HANDLER = join(__dirname, "..", "mcp", "build-design-review-handler.ts");

describe("every ideate → plan advance in reviewDesignDoc dispatches plan generation", () => {
  it("hands off after both the feature and the fix advance", () => {
    const source = readFileSync(HANDLER, "utf8");
    const advances = [...source.matchAll(/"Phase advanced: ideate → plan[^"]*"/g)];
    expect(advances.length).toBeGreaterThanOrEqual(2);
    for (const advance of advances) {
      // The hand-off must follow the advance inside the same success branch.
      const after = source.slice(advance.index!, advance.index! + 900);
      const branchEnd = after.indexOf("} else {");
      const branch = branchEnd >= 0 ? after.slice(0, branchEnd) : after;
      expect({ advance: advance[0], dispatches: branch.includes("dispatchPlanForApprovedBuild") })
        .toEqual({ advance: advance[0], dispatches: true });
    }
  });
});
