// apps/web/components/portfolio/PortfolioNodeDetail.tsx
import Link from "next/link";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import { PORTFOLIO_COLOURS, type OwnerRoleInfo } from "@/lib/portfolio";
import { ProductList } from "./ProductList";

type Product = { id: string; productId: string; name: string; lifecycleStatus: string };

type Props = {
  node: PortfolioTreeNode;
  subNodes: PortfolioTreeNode[];
  products: Product[];
  breadcrumbs: Array<{ nodeId: string; name: string }>;
  agentCount: number;
  health: string;
  investment: string;
  ownerRole: OwnerRoleInfo | null;
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
  investment,
  ownerRole,
}: Props) {
  const rootSlug = getRootSlug(node.nodeId);
  const colour = PORTFOLIO_COLOURS[rootSlug] ?? "#7c8cf8";
  const subLabel = node.parentId === null ? "Capability Domains" : "Functional Groups";

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
        <span className="text-sm" style={{ color: colour }}>
          {node.totalCount} products
        </span>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 mb-6">
        <StatBox label="Products" value={String(node.totalCount)} colour="#e2e2f0" />
        <StatBox label="Owner" value={ownerRole?.roleId ?? "—"} colour={colour} />
        <StatBox label="Agents" value={String(agentCount)} colour={colour} />
        <StatBox label="Health" value={health} colour={colour} />
        <StatBox label="Budget" value={investment} colour={colour} />
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

      {/* People */}
      <div className="mt-8">
        <PeoplePanel ownerRole={ownerRole} colour={colour} />
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

function PeoplePanel({
  ownerRole,
  colour,
}: {
  ownerRole: OwnerRoleInfo | null;
  colour: string;
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
            <p className="text-[10px] font-mono" style={{ color: colour }}>
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
