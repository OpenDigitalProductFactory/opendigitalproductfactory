import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SkillsCatalogView } from "./SkillsCatalogView";
import { measureUxBudget, UX_BUDGETS } from "@/lib/ux-budget";

// BI-36CE8BAB / BI-1D718FCA — the wall-of-text regression guard for the catalog.
//
// `/platform/ai/skills` measured 5,349 default-visible words: the 2nd-worst
// surface in the portal and ~12x its budget. Nearly all of it came from ONE
// component — a card grid rendering all 92 skills' full descriptions with
// `line-clamp-2`. Clamping is a paint-time trick: the words stay in the DOM, so
// the accessibility tree, the route sweep, and any screen reader still carry
// them. An interim cap took the route to 1,352 by hiding rows; grouping takes it
// to 203 while keeping every row reachable.
//
// This test measures the SAME artifact the CI sweep measures (served markup, via
// the sweep's own measureUxBudget) at production scale, so the regression cannot
// return quietly. It is deliberately not a snapshot — a snapshot would happily
// record a wall of text as the new normal.

/** Production shape as of 2026-07-31: 92 catalog entries, ~238-char descriptions. */
const SKILL_COUNT = 92;
const DESCRIPTION = // ~238 chars, the measured live average
  "Use this skill when the operator needs a governed path through the workflow, including the " +
  "preconditions that must hold before it runs, the evidence it records on completion, and the " +
  "escalation route when a precondition cannot be satisfied safely.";

/** Eight categories, the shape a real catalog has. */
const CATEGORIES = [
  "operations",
  "governance",
  "delivery",
  "finance",
  "marketing",
  "platform",
  "people",
  "support",
];

const skills = Array.from({ length: SKILL_COUNT }, (_, i) => ({
  id: `id-${i}`,
  skillId: `skill-${i}`,
  name: `Governed workflow skill ${i}`,
  description: DESCRIPTION,
  version: "1.0.0",
  sourceType: "builtin",
  sourceRegistry: null,
  category: CATEGORIES[i % CATEGORIES.length],
  tags: ["governance", "workflow", "evidence"],
  author: "dpf",
  license: "MIT",
  riskBand: "low",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  _count: { assignments: 3 },
}));

const stats = {
  total: SKILL_COUNT,
  byStatus: [{ status: "active", _count: SKILL_COUNT }],
  bySource: [{ sourceType: "builtin", _count: SKILL_COUNT }],
};

describe("SkillsCatalogView — default-visible budget at production scale", () => {
  const html = renderToStaticMarkup(<SkillsCatalogView skills={skills} stats={stats} />);
  const metrics = measureUxBudget(html);

  it("keeps every skill reachable — nothing is dropped to win the budget", () => {
    // The fix must be DISCLOSURE, not truncation. A capped list that silently
    // shows a subset would trade one usability defect for a worse one.
    expect(html).toContain("Governed workflow skill 0");
    expect(html).toContain(`Governed workflow skill ${SKILL_COUNT - 1}`);
    expect(html).toContain(DESCRIPTION);
  });

  it("defers the descriptions rather than clamping them", () => {
    // One closed <details> per row plus one per category group. The words all
    // exist; none of them are on arrival.
    expect(html.split("<details").length - 1).toBe(SKILL_COUNT + CATEGORIES.length);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    // The old shape — every word in the DOM behind a CSS clamp.
    expect(html).not.toContain("line-clamp-2");
  });

  it("groups rather than truncates, so arrival costs a few category headers", () => {
    expect(metrics.disclosureRegions).toBe(CATEGORIES.length);
    for (const category of CATEGORIES) expect(html).toContain(category);
  });

  it("lands inside the budget of the shell this route resolves to", () => {
    // /platform/ai/skills derives the `detail` shell (advanced-diagnostic), which
    // is STRICTER than `list`. Hold it to the stricter of the two so the local
    // assertion cannot pass while CI fails.
    const budget = Math.min(
      UX_BUDGETS.detail.maxDefaultVisibleWords,
      UX_BUDGETS.list.maxDefaultVisibleWords,
    );
    expect(metrics.defaultVisibleWords).toBeLessThanOrEqual(budget);
  });

  it("stays far below the 5,349-word baseline this route regressed from", () => {
    // This component measures 26 words in isolation; the full route measures 203
    // (the route sweep is the binding number). The ceiling is deliberately loose:
    // it guards the ORDER OF MAGNITUDE so a real regression fails loudly without
    // turning every copy edit red.
    expect(metrics.defaultVisibleWords).toBeLessThan(200);
  });
});
