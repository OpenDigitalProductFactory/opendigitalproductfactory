// Reading-level guard for the journey surface's own copy.
//
// The UX Route Budget Sweep grades the WHOLE rendered page, which needs a
// browser and ten minutes of CI. This measures the part this feature owns —
// the card copy and the page's own strings — with the SAME functions the sweep
// uses (`measureUxBudget` over `apps/web/lib/ux-budget`), so a copy regression
// is caught in the unit suite instead of by a red sweep half an hour later.
//
// It is a floor, not a replacement: passing here does not guarantee the full
// page passes, because the shell and nav also count toward the real grade.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { measureUxBudget, meetsReadingLevel } from "@/lib/ux-budget/measure";

import { JourneyHealthCard } from "@/components/ops/JourneyHealthCard";
import { journeyHealthHeadline, NEVER_RUN_SENTENCE } from "./journey-health";
import type { JourneyHealth, JourneyHealthRow } from "./journey-health";
import { BUSINESS_JOURNEYS } from "./registry";

/** The state every install sees on day one — and the one most likely to be
 *  left unexamined, which is exactly where the budget findings landed. */
function neverRunRows(): JourneyHealthRow[] {
  return BUSINESS_JOURNEYS.map((j) => ({
    journeyId: j.journeyId,
    outcome: j.outcome,
    businessImpact: j.businessImpact,
    revenueBearing: j.revenueBearing,
    status: "never-run" as const,
    achievedDepth: null,
    checkedSentence: null,
    notCheckedSentence: NEVER_RUN_SENTENCE,
    steps: [],
    durationMs: 0,
  }));
}

function renderCards(rows: JourneyHealthRow[]): string {
  return rows.map((row) => renderToStaticMarkup(<JourneyHealthCard row={row} />)).join("\n");
}

describe("journey surface copy stays within the high-school reading tier", () => {
  it("grades the empty state at or below the high-school cap", () => {
    const rows = neverRunRows();
    const health: JourneyHealth = {
      lastRunAt: null,
      runId: null,
      rows,
      failing: 0,
      passing: 0,
      notApplicable: 0,
      neverRun: rows.length,
      unverifiable: 0,
    };
    const html = `<p>${journeyHealthHeadline(health)}</p>${renderCards(rows)}`;

    const metrics = measureUxBudget(html);

    expect(metrics.readingGradeLevel).toBeLessThanOrEqual(9);
    expect(meetsReadingLevel(metrics, "high-school")).toBe(true);
  });

  it("grades the all-failing state at or below the high-school cap", () => {
    const rows = neverRunRows().map((r) => ({
      ...r,
      status: "failed" as const,
      notCheckedSentence: "Not checked: the page opens.",
    }));
    const health: JourneyHealth = {
      lastRunAt: new Date("2026-07-28T06:00:00.000Z"),
      runId: "run_1",
      rows,
      failing: rows.length,
      passing: 0,
      notApplicable: 0,
      neverRun: 0, unverifiable: 0,
    };
    // Failing cards additionally render businessImpact — the longest copy in the
    // feature — so this is the worst case for the grade.
    const html = `<p>${journeyHealthHeadline(health)}</p>${renderCards(rows)}`;

    const metrics = measureUxBudget(html);

    expect(metrics.readingGradeLevel).toBeLessThanOrEqual(9);
  });

  it("keeps every outcome and impact sentence terminated", () => {
    // Unterminated fragments merge into one very long sentence when the budget
    // joins all visible text, which is what drove the grade over the cap.
    const html = renderCards(neverRunRows());
    const headings = [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);

    expect(headings.length).toBe(BUSINESS_JOURNEYS.length);
    for (const heading of headings) {
      expect(heading.trim().endsWith(".")).toBe(true);
    }
  });
});
