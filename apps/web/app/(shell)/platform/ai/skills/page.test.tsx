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
  getSkillSeedWarnings: vi.fn().mockResolvedValue([]),
  getPendingSkillProposals: vi.fn().mockResolvedValue([]),
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

// Forward every prop, not just href: the shell stamps structural markers
// (data-owner-first-next-action, data-dpf-primary-action) onto links, and a mock
// that swallows them makes the page measure as if it had no next action. The
// fixture must not be the thing that fails the check.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { getSkillReviewDetail } from "@/lib/actions/skills-observatory";

describe("PlatformAiSkillsPage", () => {
  // BI-36CE8BAB: the page now declares a shell. The contract under test is the
  // READING ORDER — the catalog is what the reader came for and stays on
  // arrival; observability and the curator report are diagnostics and are
  // deferred. Everything still renders; nothing was removed.
  it("leads with the catalog and defers the diagnostics", async () => {
    const { default: PlatformAiSkillsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiSkillsPage({}));

    // Adopts the L1 shell, with a measurable lead band and one h1.
    expect(html).toContain('data-dpf-shell="list"');
    expect(html).toContain("data-dpf-lead");
    expect(html.split("<h1").length - 1).toBe(1);
    expect(html).toContain(">Skills</h1>");

    // The catalog is default-visible.
    expect(html).toContain("skills-catalog-view");

    // The diagnostics still render — inside the closed technical disclosure.
    const disclosure = html.slice(html.indexOf("data-dpf-disclosure"));
    expect(disclosure).toContain("Route skills");
    expect(disclosure).toContain("Observability");
    expect(disclosure).toContain("skills-observatory-panel");
    expect(disclosure).toContain("Curator");
    expect(disclosure).toContain("skills-curator-report-panel");

    // Closed by default, or it defers nothing.
    expect(html).not.toMatch(/<details[^>]*\sopen/);

    expect(html).toContain('href="/platform/ai/prompts"');
  });

  // The route is in MIGRATED_ROUTES, which strips its pre-migration exemptions —
  // so it is now held to the FULL shell contract. This asserts that with the
  // sweep's own evaluator, so the claim cannot rot into a comment.
  it("passes every budget check for the shell it resolves to", async () => {
    const { auditUxBudget } = await import("@/lib/ux-budget");
    const { default: PlatformAiSkillsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiSkillsPage({}));

    // `detail` is what shellForRoute derives for this route (admin +
    // advanced-diagnostic) and it is the stricter budget.
    const report = auditUxBudget(html, "detail", {
      exemptChecks: [],
      routeStatus: "pre-existing",
    });

    const failing = report.findings.filter((f) => !f.ok);
    expect(failing.map((f) => `${f.check}: ${f.detail}`)).toEqual([]);
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
        seedStatus: "in-sync",
        repoAvailable: true,
        candidatePaths: [
          "skills/build/build-page.skill.md",
          "packages/dpf-skill-pack/skills/build-page/SKILL.md",
        ],
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
