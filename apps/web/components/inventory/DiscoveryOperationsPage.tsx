import Link from "next/link";
import { PORTFOLIO_COLOURS } from "@/lib/portfolio";
import { getDiscoveryOperationsViewModel } from "@/lib/discovery-operations-view-model";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DataEnrichmentHelpNote } from "@/components/inventory/DataEnrichmentHelpNote";
import { DiscoveryRunSummary } from "@/components/inventory/DiscoveryRunSummary";
import { InventoryExceptionQueue } from "@/components/inventory/InventoryExceptionQueue";
import { PortfolioQualityIssuesPanel } from "@/components/inventory/PortfolioQualityIssuesPanel";
import { SavedConnectionsPanel } from "@/components/inventory/SavedConnectionsPanel";
import { SubnetGroupedInventoryPanel } from "@/components/inventory/SubnetGroupedInventoryPanel";
import { TopologyGraph } from "@/components/inventory/TopologyGraph";
import { CustomerTopologyScopeBar } from "@/components/inventory/CustomerTopologyScopeBar";
import { CollapsibleList } from "@/components/ui/report-kit/CollapsibleList";

const STATUS_COLOURS: Record<string, string> = {
  active: "var(--dpf-success)",
  draft: "var(--dpf-warning)",
  inactive: "var(--dpf-muted)",
};

/**
 * Product cards visible before the estate grid defers the rest.
 *
 * One card per DigitalProduct carrying discovery evidence: 381 cards / 20,572px
 * on the live install — two thirds of a page that stood 34 screens tall. This
 * surface resolves evidence quality and then hands off (its own header says to
 * "manage the owned estate from portfolio and product pages"), so the full
 * roster belongs behind the disclosure rather than in the arrival viewport.
 */
const ESTATE_PREVIEW_COUNT = 12;

type DiscoveryOperationsPageProps = {
  isLegacyAlias?: boolean;
};

export async function DiscoveryOperationsPage({
  isLegacyAlias = false,
}: DiscoveryOperationsPageProps) {
  const session = await auth();
  const includeConnections = !!session?.user && can({
    platformRole: session.user.platformRole,
    isSuperuser: session.user.isSuperuser,
  }, "manage_provider_connections");
  const {
    products,
    latestRun,
    groupedInventory,
    triageQueues,
    openIssues,
    graphData,
    detectedGateway,
    gatewayCandidates,
    health,
    connections,
  } = await getDiscoveryOperationsViewModel({ includeConnections });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {isLegacyAlias && (
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              Inventory Has Moved
            </p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              Discovery work now lives under Platform so portfolio and product pages can stay focused on the managed estate.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/platform/tools/discovery"
                className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-sm text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)]"
              >
                Open canonical route
              </Link>
              <Link
                href="/portfolio"
                className="rounded-full border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-text)]"
              >
                Go to portfolio estate
              </Link>
            </div>
          </div>
        )}

        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Estate Discovery</h1>
          <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
            Treat discovery as evidence. Use it to understand purpose, ownership, and dependencies across the product estate.
          </p>
        </div>

        <DataEnrichmentHelpNote />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Purpose-First Guidance
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--dpf-text)]">
            Discovery should explain why an item exists, what it supports, and what breaks when it changes. Resolve evidence quality here, then manage the owned estate from portfolio and product pages.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Products linked</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{products.length}</p>
          </div>
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Needs review</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{triageQueues.metrics.total}</p>
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <DiscoveryRunSummary run={latestRun} health={health} />
        <SavedConnectionsPanel
          detectedGateway={detectedGateway}
          gatewayCandidates={gatewayCandidates}
          connections={connections}
        />
        <InventoryExceptionQueue queues={triageQueues} />
        <SubnetGroupedInventoryPanel groups={groupedInventory} />
        <PortfolioQualityIssuesPanel issues={openIssues} />
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
            Topology And Dependency Evidence
          </p>
        </div>
        <CustomerTopologyScopeBar
          mode="organization-internal"
          scopeLabel="MSP Internal"
          lastRunLabel="Global discovery view"
        />
        <TopologyGraph data={graphData} />
      </div>


      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
              Attributed Estate
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">Products With Discovery Evidence</h2>
          </div>
          <Link href="/portfolio" className="text-sm text-[var(--dpf-accent)]">
            Manage in Portfolio →
          </Link>
        </div>

        <p className="text-dpf-caption text-[var(--dpf-muted)]">
          Open a product to review dependencies, supporting items, and posture in context.
        </p>

        <CollapsibleList
          as="div"
          previewCount={ESTATE_PREVIEW_COUNT}
          listClassName="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {products.map((product) => {
            const colour = product.portfolio
              ? (PORTFOLIO_COLOURS[product.portfolio.slug] ?? "var(--dpf-accent)")
              : "var(--dpf-border)";
            const statusColour = STATUS_COLOURS[product.lifecycleStatus] ?? "var(--dpf-muted)";
            const taxonomyPath = product.taxonomyNode
              ? product.taxonomyNode.nodeId.replace(/\//g, " / ")
              : null;

            return (
              <Link
                key={product.id}
                href={`/portfolio/product/${product.id}/inventory`}
                className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:border-[var(--dpf-accent)]"
                style={{ borderLeft: `4px solid ${colour}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">{product.name}</p>
                    {product.portfolio && (
                      <p className="mt-1 text-dpf-caption font-medium" style={{ color: colour }}>
                        {product.portfolio.name}
                      </p>
                    )}
                  </div>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-dpf-caption"
                    style={{ backgroundColor: `${statusColour}20`, color: statusColour }}
                  >
                    {product.lifecycleStatus}
                  </span>
                </div>
                {taxonomyPath && (
                  <p className="mt-2 text-dpf-caption font-mono text-[var(--dpf-muted)]">{taxonomyPath}</p>
                )}
              </Link>
            );
          })}
        </CollapsibleList>

        {products.length === 0 && (
          <p className="text-sm text-[var(--dpf-muted)]">
            No products are linked to discovered estate evidence yet.
          </p>
        )}
      </div>
    </div>
  );
}
