import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getPortfolioBudgetMetric } from "@/lib/portfolio/budget-provenance";
import type { PortfolioSummary } from "@/lib/portfolio-data";
import type { PortfolioTreeNode } from "@/lib/portfolio";

vi.mock("next/link", () => ({
  default: ({ href, children, className, style }: { href: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>
      {children}
    </a>
  ),
}));

vi.mock("./PlatformHealthStrip", () => ({
  PlatformHealthStrip: () => null,
}));

import { PortfolioOverview } from "./PortfolioOverview";

const SUMMARY: PortfolioSummary = {
  totalProducts: 1,
  activeProducts: 1,
  draftProducts: 0,
  retiredProducts: 0,
  lifecycleStages: { production: 1 },
  openBacklogItems: 0,
  inProgressBacklogItems: 0,
  openEpics: 0,
  totalAgents: 1,
  activeAgents: 1,
};

const ROOTS: PortfolioTreeNode[] = [
  {
    id: "root-foundational",
    nodeId: "foundational",
    name: "Foundational",
    parentId: null,
    portfolioId: "portfolio-foundational",
    directCount: 1,
    totalCount: 1,
    activeCount: 1,
    description: null,
    governance: null,
    enrichment: null,
    children: [],
  },
];

describe("PortfolioOverview", () => {
  it("renders portfolio budget provenance next to placeholder values", () => {
    const html = renderToStaticMarkup(
      <PortfolioOverview
        roots={ROOTS}
        agentCounts={{ foundational: 1 }}
        budgets={{ foundational: getPortfolioBudgetMetric("foundational", 2500) }}
        summary={SUMMARY}
      />,
    );

    expect(html).toContain("$2.5M");
    expect(html).toContain("Planning placeholder");
    expect(html).toContain('data-source-kind="demo-placeholder"');
    expect(html).toContain(">Digital product architecture<");
    expect(html).not.toContain("<h1");
  });
});
