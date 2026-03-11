// apps/web/components/portfolio/PortfolioNodeDetail.tsx
import Link from "next/link";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES } from "@/lib/portfolio";
import { ProductList } from "./ProductList";

type Product = { id: string; productId: string; name: string; status: string };

type Props = {
  node: PortfolioTreeNode;
  subNodes: PortfolioTreeNode[];
  products: Product[];
  breadcrumbs: Array<{ nodeId: string; name: string }>;
  agentCount: number;
  health: string;
};

function getRootSlug(nodeId: string): string {
  return nodeId.split("/")[0] ?? nodeId;
}

export function PortfolioNodeDetail({
  node,
  subNodes,
  products,
  breadcrumbs,
  agentCount,
  health,
}: Props) {
  const rootSlug = getRootSlug(node.nodeId);
  const colour = PORTFOLIO_COLOURS[rootSlug] ?? "#7c8cf8";
  const ownerRole = PORTFOLIO_OWNER_ROLES[rootSlug] ?? "—";
  const subLabel = node.parentId === null ? "Capability Domains" : "Functional Groups";

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-[var(--dpf-muted)] mb-4">
        <Link href="/portfolio" className="hover:text-white transition-colors">
          Portfolio
        </Link>
        {breadcrumbs.map((bc) => (
          <span key={bc.nodeId} className="flex items-center gap-1">
            <span>›</span>
            <Link
              href={`/portfolio/${bc.nodeId}`}
              className="hover:text-white transition-colors"
            >
              {bc.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* Title */}
      <div className="flex items-baseline gap-3 mb-5">
        <h1 className="text-xl font-bold text-white">{node.name}</h1>
        <span className="text-sm" style={{ color: colour }}>
          {node.totalCount} products
        </span>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 mb-6">
        <StatBox label="Products" value={String(node.totalCount)} colour="#e2e2f0" />
        <StatBox label="Owner" value={ownerRole} colour={colour} />
        <StatBox label="Agents" value={String(agentCount)} colour={colour} />
        <StatBox label="Health" value={health} colour={colour} />
        <StatBox label="Investment" value="—" colour="#555566" dashed />
      </div>

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
                <span className="text-sm text-[#e2e2f0]">{child.name}</span>
                {child.totalCount > 0 && (
                  <span
                    className="text-[9px] px-2 py-0.5 rounded-full"
                    style={{ background: `${colour}20`, color: colour }}
                  >
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
        <ProductList products={products} colour={colour} />
      )}

      {/* Empty state */}
      {subNodes.length === 0 && products.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">
          No products classified here yet.
        </p>
      )}

      {/* People placeholder */}
      <div className="mt-8">
        <PlaceholderPanel label="People" description="Human role assignments — coming soon" />
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  colour,
  dashed = false,
}: {
  label: string;
  value: string;
  colour: string;
  dashed?: boolean;
}) {
  return (
    <div
      className={`bg-[var(--dpf-surface-1)] rounded-lg px-4 py-2.5 text-center ${
        dashed ? "border border-dashed border-[var(--dpf-border)] opacity-40" : "border border-[var(--dpf-border)]"
      }`}
    >
      <p className="text-sm font-bold" style={{ color: colour }}>
        {value}
      </p>
      <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">
        {label}
      </p>
    </div>
  );
}

function PlaceholderPanel({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="bg-[var(--dpf-surface-1)] border border-dashed border-[var(--dpf-border)] rounded-lg p-4 opacity-50">
      <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className="text-xs text-[var(--dpf-muted)]">{description}</p>
    </div>
  );
}
