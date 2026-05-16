import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/skill-marketplace", () => ({
  getSkillCatalog: vi.fn().mockResolvedValue([]),
  getSkillCatalogStats: vi.fn().mockResolvedValue({
    total: 2,
    byStatus: [],
    bySource: [],
  }),
}));

vi.mock("@/lib/actions/skills-observatory", () => ({
  getSkillsCatalog: vi.fn().mockResolvedValue([]),
  getFinishingPassActivity: vi.fn().mockResolvedValue([]),
  getSpecialistExecutions: vi.fn().mockResolvedValue([]),
  getSkillsObservatoryStats: vi.fn().mockResolvedValue({
    totalSkills: 4,
    routes: 3,
  }),
  getSkillTelemetrySummary: vi.fn().mockResolvedValue({
    totalUsageEvents: 0,
    eligibleEvents: 0,
    loadedEvents: 0,
    invokedEvents: 0,
    completedEvents: 0,
    failedEvents: 0,
    metricRowCount: 0,
    activeSkillCount: 0,
    latestMetricPeriod: null,
  }),
  getSkillReviewDetail: vi.fn().mockResolvedValue(null),
  getLatestSkillCuratorReport: vi.fn().mockResolvedValue(null),
  getSkillLifecycleState: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/components/platform/SkillProposalsPanel", () => ({
  SkillProposalsPanel: () => <div>skills-proposals-panel</div>,
}));

vi.mock("@/components/platform/SkillRevisionHistoryPanel", () => ({
  SkillRevisionHistoryPanel: () => <div>skills-revision-history-panel</div>,
}));

vi.mock("@/components/admin/SkillsCatalogView", () => ({
  SkillsCatalogView: () => <div>skills-catalog-view</div>,
}));

vi.mock("@/components/platform/SkillsObservatoryPanel", () => ({
  SkillsObservatoryPanel: () => <div>skills-observatory-panel</div>,
}));

vi.mock("@/components/platform/SkillCuratorReportPanel", () => ({
  SkillCuratorReportPanel: () => <div>skills-curator-report-panel</div>,
}));

vi.mock("@/components/platform/SkillLifecycleControls", () => ({
  SkillLifecycleControls: () => <div>skills-lifecycle-controls</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { getSkillReviewDetail } from "@/lib/actions/skills-observatory";

describe("PlatformAiSkillsPage", () => {
  it("renders catalog, observability, and curator under AI Operations", async () => {
    const { default: PlatformAiSkillsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiSkillsPage({}));

    expect(html).toContain("AI Operations");
    expect(html).toContain("Catalog");
    expect(html).toContain("Route Skills");
    expect(html).toContain("Observability");
    expect(html).toContain('href="/platform/ai/prompts"');
    expect(html).toContain("skills-catalog-view");
    expect(html).toContain("skills-observatory-panel");
    expect(html).toContain("Curator");
    expect(html).toContain("skills-curator-report-panel");
  });

  it("renders scoped evidence for a focused skill detail", async () => {
    vi.mocked(getSkillReviewDetail).mockResolvedValueOnce({
      skillId: "build-page",
      skillMdContent: "v0",
      category: "build",
      proposals: [],
      revisions: [],
      seedDrift: {
        inSync: true,
        dbBody: "v0",
        seedBody: "v0",
        seedPath: "skills/build/build-page.skill.md",
      },
      evidence: [
        {
          kind: "tool_execution",
          id: "tool-1",
          label: "apply_patch failed",
          summary: "Patch failed after timeout while applying skill guidance.",
          createdAt: "2026-05-15T12:05:00.000Z",
          refs: {
            skillId: "build-page",
            threadId: "thread-1",
            taskRunId: "TR-1",
          },
        },
      ],
    });

    const { default: PlatformAiSkillsPage } = await import("./page");
    const html = renderToStaticMarkup(
      await PlatformAiSkillsPage({
        searchParams: Promise.resolve({ skill: "build-page" }),
      }),
    );

    expect(html).toContain("Evidence");
    expect(html).toContain("apply_patch failed");
    expect(html).toContain("Patch failed after timeout");
  });
});
