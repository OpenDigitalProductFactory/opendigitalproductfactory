// apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getFullPortfolioTree, getAgentCounts, getPortfolioBudgets, getPortfolioOwnerRoles, getPortfolioSummary } from "@/lib/portfolio-data";
import { resolveNodeFromSlug, getSubtreeIds, buildBreadcrumbs, computeHealth } from "@/lib/portfolio";
import { PortfolioOverview } from "@/components/portfolio/PortfolioOverview";
import { PortfolioNodeDetail } from "@/components/portfolio/PortfolioNodeDetail";
import { CompletenessStrip } from "@/components/portfolio/CompletenessStrip";
import { getFullGraphData } from "@/lib/actions/graph";
import {
  computePortfolioCompleteness,
  type PortfolioCompletenessDb,
} from "@/lib/portfolio/completeness";

type Props = {
  params: Promise<{ slug?: string[] }>;
};

export default async function PortfolioPage({ params }: Props) {
  const { slug } = await params;
  const slugs = slug ?? [];
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
    return <PortfolioOverview roots={roots} agentCounts={agentCounts} budgets={budgets} summary={summary} />;
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
  const investment = budgets[rootSlug] ?? "—";
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

  return (
    <div>
      {completenessScores ? <CompletenessStrip scores={completenessScores} /> : null}
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
