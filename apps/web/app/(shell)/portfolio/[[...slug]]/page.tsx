// apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getPortfolioTree, getAgentCounts } from "@/lib/portfolio-data";
import { resolveNodeFromSlug, getSubtreeIds, buildBreadcrumbs, computeHealth } from "@/lib/portfolio";
import { PortfolioOverview } from "@/components/portfolio/PortfolioOverview";
import { PortfolioNodeDetail } from "@/components/portfolio/PortfolioNodeDetail";

type Props = {
  params: { slug?: string[] };
};

export default async function PortfolioPage({ params }: Props) {
  const slugs = params.slug ?? [];
  const [roots, agentCounts] = await Promise.all([
    getPortfolioTree(),
    getAgentCounts(),
  ]);

  // Overview: /portfolio
  if (slugs.length === 0) {
    return <PortfolioOverview roots={roots} agentCounts={agentCounts} />;
  }

  // Node detail: /portfolio/[...slug]
  const node = resolveNodeFromSlug(roots, slugs);
  if (!node) return notFound();

  // Fetch products in this node's subtree
  const subtreeIds = getSubtreeIds([node]);
  const products = await prisma.digitalProduct.findMany({
    where: {
      taxonomyNodeId: { in: subtreeIds },
      status: "active",
    },
    select: { id: true, productId: true, name: true, status: true },
    orderBy: { name: "asc" },
  });

  const breadcrumbs = buildBreadcrumbs(roots, slugs);

  const rootSlug = slugs[0] ?? ""; // slugs.length === 0 handled above; ?? "" satisfies noUncheckedIndexedAccess
  const agentCount = agentCounts[rootSlug] ?? 0;
  const healthStr = computeHealth(node.activeCount, node.totalCount);

  return (
    <PortfolioNodeDetail
      node={node}
      subNodes={node.children}
      products={products}
      breadcrumbs={breadcrumbs}
      agentCount={agentCount}
      health={healthStr}
    />
  );
}
