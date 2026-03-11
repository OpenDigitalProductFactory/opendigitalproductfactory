// apps/web/components/portfolio/PortfolioOverview.tsx
import Link from "next/link";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES } from "@/lib/portfolio";

type Props = { roots: PortfolioTreeNode[] };

export function PortfolioOverview({ roots }: Props) {
  const totalProducts = roots.reduce((sum, r) => sum + r.totalCount, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Portfolio</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {roots.length} portfolios · {totalProducts} products
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {roots.map((root) => {
          const colour = PORTFOLIO_COLOURS[root.nodeId] ?? "#7c8cf8";
          const ownerRole = PORTFOLIO_OWNER_ROLES[root.nodeId] ?? "—";
          return (
            <Link
              key={root.nodeId}
              href={`/portfolio/${root.nodeId}`}
              className="block p-5 rounded-lg bg-[var(--dpf-surface-1)] border-l-4 hover:bg-[var(--dpf-surface-2)] transition-colors"
              style={{ borderLeftColor: colour }}
            >
              <h2 className="text-base font-semibold text-white mb-3">
                {root.name}
              </h2>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xl font-bold text-white">
                    {root.totalCount}
                  </p>
                  <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
                    Products
                  </p>
                </div>
                <div>
                  <p
                    className="text-sm font-bold"
                    style={{ color: colour }}
                  >
                    {ownerRole}
                  </p>
                  <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
                    Owner
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
