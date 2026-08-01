import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PromptManager } from "./PromptManager";
import { SkillsCatalogView } from "./SkillsCatalogView";
import { SkillsObservatoryPanel } from "@/components/platform/SkillsObservatoryPanel";

function catalogSkill(index: number) {
  return {
    id: `skill-${index}`,
    skillId: `skill-${index}`,
    name: `Catalog skill ${index}`,
    description: `Description for catalog skill ${index}`,
    version: "1.0.0",
    sourceType: "seed",
    sourceRegistry: null,
    category: "product-management",
    tags: ["product"],
    author: null,
    license: null,
    riskBand: "low",
    status: "active",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    _count: { assignments: 1 },
  };
}

describe("AI catalog progressive disclosure", () => {
  it("collapses prompt categories until the operator opens one", () => {
    const html = renderToStaticMarkup(
      <PromptManager
        initialCatalog={[
          {
            category: "product-management",
            label: "Product management",
            prompts: [
              {
                id: "prompt-1",
                category: "product-management",
                slug: "weekly-review",
                name: "Weekly product review",
                description: "Prepare an evidence-backed review.",
                version: 1,
                isOverridden: false,
                enabled: true,
                updatedAt: new Date("2026-07-30T00:00:00.000Z"),
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Product management");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Weekly product review");
  });

  // Was: "limits the initial skills catalog instead of rendering every skill",
  // asserting a 12-item cap with a "Show 3 more" control.
  //
  // The cap traded one usability defect for a worse one. A capped list is a
  // MASKED list (BI-836923AD): the reader is shown a subset with no way to know
  // what is missing, and search over the full set silently disagrees with what
  // is on screen. The catalog now groups by category and collapses the groups
  // (BI-36CE8BAB), which costs the reader a few category headers on arrival
  // instead of hiding rows — and measured better doing it: 5,349 default-visible
  // words down to 26 for this component, versus the ~500 the cap still rendered.
  it("groups the catalog rather than hiding rows behind a cap", () => {
    const html = renderToStaticMarkup(
      <SkillsCatalogView
        skills={Array.from({ length: 15 }, (_, index) => catalogSkill(index + 1))}
        stats={{
          total: 15,
          byStatus: [{ status: "active", _count: 15 }],
          bySource: [{ sourceType: "seed", _count: 15 }],
        }}
      />,
    );

    // Every skill is reachable — nothing is dropped to win the budget.
    expect(html).toContain("Catalog skill 12");
    expect(html).toContain("Catalog skill 13");
    expect(html).toContain("Catalog skill 15");
    expect(html).not.toContain("Show 3 more");

    // Deferred, not merely hidden: the group is a closed <details>, so the rows
    // are excised from the measured default-visible scope.
    expect(html).toContain("product-management");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it("limits route skills and defers the high-cardinality route filter", () => {
    const skills = Array.from({ length: 15 }, (_, index) => ({
      route: `/route-${index + 1}`,
      label: `Route skill ${index + 1}`,
      description: "Evidence-backed route skill.",
      prompt: "Review the evidence.",
      audience: "user" as const,
      capability: null,
      taskType: "advisory",
    }));
    const html = renderToStaticMarkup(
      <SkillsObservatoryPanel
        skills={skills}
        finishingPasses={[]}
        specialistExecutions={[]}
        stats={{
          totalSkills: 15,
          userFacing: 15,
          universal: 0,
          specialistInternal: 0,
          routes: 15,
          totalToolExecutions: 0,
          totalBuildActivities: 0,
        }}
      />,
    );

    expect(html).toContain("Route skill 12");
    expect(html).not.toContain("Route skill 13");
    expect(html).toContain("Show 3 more");
    expect(html).toContain('aria-label="Filter by route"');
    expect(html).toContain(">Route</button>");
  });
});
