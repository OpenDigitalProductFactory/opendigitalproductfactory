// apps/web/components/portfolio/PortfolioNodeDetail.tsx
import Link from "next/link";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import type { OwnerRoleInfo } from "@/lib/portfolio";
import type { PortfolioBudgetMetric } from "@/lib/portfolio/budget-provenance";
import type { DataSourceProvenance } from "@/lib/surface-data-provenance";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { ProductList } from "./ProductList";
import { TopologyGraph } from "@/components/inventory/TopologyGraph";
import type { GraphData } from "@/lib/actions/graph";
import { toPortfolioNodeViewModel } from "@/lib/portfolio/portfolio-node-view-model";
import { PortfolioNodeAbout } from "./PortfolioNodeAbout";
import { PortfolioNodeGovernance } from "./PortfolioNodeGovernance";
import { PortfolioNodeEnrichment } from "./PortfolioNodeEnrichment";

type Product = { id: string; productId: string; name: string; lifecycleStatus: string };

type Props = {
  node: PortfolioTreeNode;
  subNodes: PortfolioTreeNode[];
  products: Product[];
  breadcrumbs: Array<{ nodeId: string; name: string }>;
  agentCount: number;
  health: string;
  investment: PortfolioBudgetMetric;
  ownerRole: OwnerRoleInfo | null;
  graphData?: GraphData;
  taxonomyNodeId?: string;
};

export function PortfolioNodeDetail({
  node,
  subNodes,
  products,
  breadcrumbs,
  agentCount,
  health,
  investment,
  ownerRole,
  graphData,
  taxonomyNodeId,
}: Props) {
  const subLabel = node.parentId === null ? "Capability Domains" : "Functional Groups";

  // Task 3.3: typed view model for the description / governance / enrichment
  // JSON columns. View model handles null/empty input gracefully and the three
  // section components return null when there's nothing to render -- so this is
  // a no-op for nodes that have none of these fields populated.
  const vm = toPortfolioNodeViewModel({
    description: node.description ?? null,
    governance: node.governance ?? null,
    enrichment: node.enrichment ?? null,
  });

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-[var(--dpf-muted)] mb-4">
        <Link href="/portfolio" className="hover:text-[var(--dpf-text)] transition-colors">
          Portfolio
        </Link>
        {breadcrumbs.map((bc) => (
          <span key={bc.nodeId} className="flex items-center gap-1">
            <span>›</span>
            <Link
              href={`/portfolio/${bc.nodeId}`}
              className="hover:text-[var(--dpf-text)] transition-colors"
            >
              {bc.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* Title */}
      <div className="flex items-baseline gap-3 mb-5">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{node.name}</h1>
        <span className="text-sm text-[var(--dpf-accent)]">
          {node.totalCount} products
        </span>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 mb-6">
        <StatBox label="Products" value={String(node.totalCount)} />
        <StatBox label="Owner" value={ownerRole?.roleId ?? "—"} />
        <StatBox label="Coworkers" value={String(agentCount)} />
        <StatBox label="Health" value={health} />
        <StatBox
          label="Budget"
          value={investment.value}
          provenance={investment.provenance}
        />
      </div>

      {/* About / Governance / Enrichment (Task 3.3): each renders null when its
       *  source view-model field is empty -- no empty bands. */}
      <PortfolioNodeAbout about={vm.about} />
      <PortfolioNodeGovernance governance={vm.governance} />
      <PortfolioNodeEnrichment enrichment={vm.enrichment} />

      {/* Sub-nodes */}
      {subNodes.length > 0 && (
        <div className="mb-6">
          <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
            {subLabel}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {subNodes.map((child) => (
              <Link
                key={child.nodeId}
                href={`/portfolio/${child.nodeId}`}
                className="flex items-center justify-between p-3 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg hover:bg-[var(--dpf-surface-2)] transition-colors"
              >
                <span className="text-sm text-[var(--dpf-text)]">{child.name}</span>
                {child.totalCount > 0 && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-accent)]">
                    {child.totalCount}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Products */}
      {products.length > 0 && (
        <ProductList products={products} />
      )}

      {/* Empty state */}
      {subNodes.length === 0 && products.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">
          No products classified here yet.
        </p>
      )}

      {/* Topology Graph */}
      {graphData && graphData.nodes.length > 0 && (
        <div className="mt-6">
          <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
            Infrastructure Topology
          </p>
          <TopologyGraph data={graphData} taxonomyNodeId={taxonomyNodeId} />
        </div>
      )}

      {/* People */}
      <div className="mt-8">
        <PeoplePanel ownerRole={ownerRole} />
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  provenance,
  dashed = false,
}: {
  label: string;
  value: string;
  provenance?: DataSourceProvenance;
  dashed?: boolean;
}) {
  return (
    <div
      className={`bg-[var(--dpf-surface-1)] rounded-lg px-4 py-2.5 text-center ${
        dashed ? "border border-dashed border-[var(--dpf-border)] opacity-40" : "border border-[var(--dpf-border)]"
      }`}
    >
      <p className="text-sm font-bold text-[var(--dpf-accent)]">
        {value}
      </p>
      <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">
        {label}
      </p>
      {provenance && (
        <div className="mt-1 flex justify-center">
          <DataSourceBadge compact provenance={provenance} />
        </div>
      )}
    </div>
  );
}

function PeoplePanel({
  ownerRole,
}: {
  ownerRole: OwnerRoleInfo | null;
}) {
  return (
    <div>
      <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
        People
      </p>
      {ownerRole === null ? (
        <p className="text-xs text-[var(--dpf-muted)]">No owner role assigned.</p>
      ) : (
        <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg px-4 py-3">
          <div className="flex items-baseline gap-2 mb-1">
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{ownerRole.name}</p>
            <p className="text-[10px] font-mono text-[var(--dpf-accent)]">
              {ownerRole.roleId}
            </p>
          </div>
          {ownerRole.description !== null && (
            <p className="text-xs text-[var(--dpf-muted)] mb-2">{ownerRole.description}</p>
          )}
          <p className="text-[10px] text-[var(--dpf-muted)]">
            {ownerRole.userCount === 0
              ? "No users assigned"
              : ownerRole.userCount === 1
              ? "1 person"
              : `${ownerRole.userCount} people`}
          </p>
        </div>
      )}
    </div>
  );
}
