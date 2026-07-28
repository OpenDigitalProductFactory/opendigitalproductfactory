// apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getFullPortfolioTree, getAgentCounts, getPortfolioBudgets, getPortfolioOwnerRoles, getPortfolioSummary } from "@/lib/portfolio-data";
import { resolveNodeFromSlug, getSubtreeIds, buildBreadcrumbs, computeHealth } from "@/lib/portfolio";
import { getPortfolioBudgetMetric } from "@/lib/portfolio/budget-provenance";
import { PortfolioOverview } from "@/components/portfolio/PortfolioOverview";
import { PortfolioNodeDetail } from "@/components/portfolio/PortfolioNodeDetail";
import { CompletenessStrip } from "@/components/portfolio/CompletenessStrip";
import { CoveragePanel } from "@/components/portfolio/CoveragePanel";
import { getFullGraphData } from "@/lib/actions/graph";
import {
  computePortfolioCompleteness,
  type PortfolioCompletenessDb,
} from "@/lib/portfolio/completeness";
import { PlatformGridSection, parseSurfaceView } from "@/components/workbooks/PlatformGridSection";
import { BusinessProductPortfolioSection } from "@/components/product/BusinessProductPortfolioSection";

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams?: Promise<{ view?: string }>;
};

export default async function PortfolioPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const slugs = slug ?? [];
  const view = parseSurfaceView((await searchParams)?.view);
  const [roots, agentCounts, budgets, ownerRoles, summary] = await Promise.all([
    getFullPortfolioTree(),
    getAgentCounts(),
    getPortfolioBudgets(),
    getPortfolioOwnerRoles(),
    getPortfolioSummary(),
  ]);

  // Overview: /portfolio
  // No single resolved root portfolio at this level -- the overview spans all
  // four portfolio roots. Per Task 7.2 spec, omit the strip silently.
  if (slugs.length === 0) {
    return (
      <>
        <div data-dpf-lead className="mb-dpf-xl">
          <h1 className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
            Products
          </h1>
          <p className="mt-dpf-2xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
            Manage what the business sells, then inspect the digital
            architecture that enables it.
          </p>
        </div>
        <BusinessProductPortfolioSection />
        <PlatformGridSection entityType="digital_product" view={view} />
        {!view && (
          <PortfolioOverview roots={roots} agentCounts={agentCounts} budgets={budgets} summary={summary} />
        )}
      </>
    );
  }

  // Node detail: /portfolio/[...slug]
  const node = resolveNodeFromSlug(roots, slugs);
  if (!node) return notFound();

  // Fetch products in this node's subtree
  const subtreeIds = getSubtreeIds([node]);
  const products = await prisma.digitalProduct.findMany({
    where: {
      taxonomyNodeId: { in: subtreeIds },
      lifecycleStatus: "active",
    },
    select: { id: true, productId: true, name: true, lifecycleStatus: true },
    orderBy: { name: "asc" },
  });

  const graphData = await getFullGraphData();
  const breadcrumbs = buildBreadcrumbs(roots, slugs);

  const rootSlug = slugs[0] ?? ""; // slugs.length === 0 handled above; ?? "" satisfies noUncheckedIndexedAccess
  const agentCount = agentCounts[rootSlug] ?? 0;
  const investment = budgets[rootSlug] ?? getPortfolioBudgetMetric(rootSlug, null);
  const ownerRole = ownerRoles[rootSlug] ?? null;
  const healthStr = computeHealth(node.activeCount, node.totalCount);

  // Task 7.2: completeness strip above the existing detail. The portfolioId
  // comes from the resolved root (slugs[0]) -- inner nodes inherit their root
  // portfolio's completeness scope. Omit silently when the root has no
  // portfolioId attached (taxonomy-only branch with no Portfolio peer).
  // PrismaClient is a structural superset of PortfolioCompletenessDb (the
  // helper's narrow injectable shape); cast via `unknown` matches the same
  // pattern used in promotion-audit/page.tsx.
  const rootNode = roots.find((r) => r.nodeId === rootSlug);
  const rootPortfolioId = rootNode?.portfolioId ?? null;
  const completenessScores = rootPortfolioId
    ? await computePortfolioCompleteness(
        rootPortfolioId,
        prisma as unknown as PortfolioCompletenessDb,
      )
    : null;

  // BI-PORTCOV-P6: coverage surface at the portfolio root — every entry in this
  // portfolio (any status), grouped by coverage with provenance + enable links.
  // Shown only at the root node (inner taxonomy nodes keep the active subtree list).
  const coverageProducts =
    rootPortfolioId && node.nodeId === rootSlug
      ? await prisma.digitalProduct.findMany({
          where: { portfolioId: rootPortfolioId },
          select: { id: true, productId: true, name: true, observationConfig: true },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <div>
      {completenessScores ? <CompletenessStrip scores={completenessScores} /> : null}
      {coverageProducts.length > 0 ? (
        <CoveragePanel products={coverageProducts} className="mb-4" />
      ) : null}
      <PortfolioNodeDetail
        node={node}
        subNodes={node.children}
        products={products}
        breadcrumbs={breadcrumbs}
        agentCount={agentCount}
        health={healthStr}
        investment={investment}
        ownerRole={ownerRole}
        graphData={graphData}
        taxonomyNodeId={node.nodeId}
      />
    </div>
  );
}
