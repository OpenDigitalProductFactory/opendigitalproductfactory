// apps/web/app/(shell)/inventory/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { PORTFOLIO_COLOURS } from "@/lib/portfolio";
import {
  getInventoryEntitiesForPage,
  getLatestDiscoveryRun,
  getOpenPortfolioQualityIssues,
  summarizeDiscoveryHealth,
} from "@/lib/discovery-data";
import { DiscoveryRunSummary } from "@/components/inventory/DiscoveryRunSummary";
import { InventoryEntityPanel } from "@/components/inventory/InventoryEntityPanel";
import { PortfolioQualityIssuesPanel } from "@/components/inventory/PortfolioQualityIssuesPanel";

const STATUS_COLOURS: Record<string, string> = {
  active:   "#4ade80",  // green-400
  draft:    "#fbbf24",  // amber-400
  inactive: "#555566",  // muted
};

export default async function InventoryPage() {
  const [products, latestRun, inventoryEntities, openIssues] = await Promise.all([
    prisma.digitalProduct.findMany({
      orderBy: [{ portfolio: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        lifecycleStatus: true,
        portfolio: { select: { slug: true, name: true } },
        taxonomyNode: { select: { nodeId: true } },
      },
    }),
    getLatestDiscoveryRun(),
    getInventoryEntitiesForPage(),
    getOpenPortfolioQualityIssues(),
  ]);
  const health = summarizeDiscoveryHealth({
    totalEntities: inventoryEntities.length,
    staleEntities: inventoryEntities.filter((entity) => entity.status === "stale").length,
    openIssues: openIssues.length,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Inventory</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {products.length} product{products.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="space-y-4">
        <DiscoveryRunSummary run={latestRun} health={health} />
        <InventoryEntityPanel entities={inventoryEntities} />
        <PortfolioQualityIssuesPanel issues={openIssues} />
      </div>

      <div className="mt-8">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
            Product Inventory
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Digital Products</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {products.map((p) => {
            const colour = p.portfolio ? (PORTFOLIO_COLOURS[p.portfolio.slug] ?? "#7c8cf8") : "#555566";
            const statusColour = STATUS_COLOURS[p.lifecycleStatus] ?? "#555566";
            const href = p.taxonomyNode
              ? `/portfolio/${p.taxonomyNode.nodeId}`
              : p.portfolio
              ? `/portfolio/${p.portfolio.slug}`
              : null;
            const taxonomyPath = p.taxonomyNode
              ? p.taxonomyNode.nodeId.replace(/\//g, " / ")
              : null;

            const card = (
              <div
                className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
                style={{ borderLeftColor: colour }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-white leading-tight">{p.name}</p>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ background: `${statusColour}20`, color: statusColour }}
                  >
                    {p.lifecycleStatus}
                  </span>
                </div>
                {p.portfolio && (
                  <p className="text-[10px] font-medium mb-0.5" style={{ color: colour }}>
                    {p.portfolio.name}
                  </p>
                )}
                {taxonomyPath && (
                  <p className="text-[9px] text-[var(--dpf-muted)] font-mono">{taxonomyPath}</p>
                )}
              </div>
            );

            return href ? (
              <Link
                key={p.id}
                href={href}
                className="block hover:opacity-80 transition-opacity"
              >
                {card}
              </Link>
            ) : (
              <div key={p.id}>{card}</div>
            );
          })}
        </div>

        {products.length === 0 && (
          <p className="text-sm text-[var(--dpf-muted)]">No products registered yet.</p>
        )}
      </div>
    </div>
  );
}
