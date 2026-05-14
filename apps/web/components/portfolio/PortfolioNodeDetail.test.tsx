import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getPortfolioBudgetMetric } from "@/lib/portfolio/budget-provenance";
import type { PortfolioTreeNode } from "@/lib/portfolio";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/inventory/TopologyGraph", () => ({
  TopologyGraph: () => null,
}));

import { PortfolioNodeDetail } from "./PortfolioNodeDetail";

const NODE: PortfolioTreeNode = {
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
};

describe("PortfolioNodeDetail", () => {
  it("renders investment provenance in the stat strip", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeDetail
        node={NODE}
        subNodes={[]}
        products={[]}
        breadcrumbs={[]}
        agentCount={0}
        health="100%"
        investment={getPortfolioBudgetMetric("foundational", 2500)}
        ownerRole={null}
        taxonomyNodeId="foundational"
      />,
    );

    expect(html).toContain("$2.5M");
    expect(html).toContain("Planning placeholder");
    expect(html).toContain('data-source-kind="demo-placeholder"');
  });
});
