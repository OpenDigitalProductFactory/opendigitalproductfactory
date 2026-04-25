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
}));

vi.mock("@/components/admin/SkillsCatalogView", () => ({
  SkillsCatalogView: () => <div>skills-catalog-view</div>,
}));

vi.mock("@/components/platform/SkillsObservatoryPanel", () => ({
  SkillsObservatoryPanel: () => <div>skills-observatory-panel</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("PlatformAiSkillsPage", () => {
  it("renders catalog and observability under AI Operations", async () => {
    const { default: PlatformAiSkillsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiSkillsPage());

    expect(html).toContain("AI Operations");
    expect(html).toContain("Catalog");
    expect(html).toContain("Route Skills");
    expect(html).toContain("Observability");
    expect(html).toContain('href="/platform/ai/prompts"');
    expect(html).toContain("skills-catalog-view");
    expect(html).toContain("skills-observatory-panel");
  });
});
