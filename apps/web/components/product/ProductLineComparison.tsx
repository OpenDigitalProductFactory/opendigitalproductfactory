import Link from "next/link";
import { EmptyState, Notice, StatusBadge } from "@/components/ui/report-kit";
import type { ProductLineComparisonRow } from "@/lib/product-management/product-line-direction-view";

function formatMoney(value: number, currency: string | null): string {
  if (!currency) return "Mixed currencies";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function ProductLineComparison({
  rows,
}: {
  rows: ProductLineComparisonRow[];
}) {
  return (
    <section aria-labelledby="product-line-comparison">
      <div data-dpf-lead>
        <h2
          id="product-line-comparison"
          className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
        >
          Product comparison
        </h2>
        <p className="mt-dpf-2xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
          Compare only recorded Product Sold evidence. Margin, adoption,
          forecasts, and outcomes are not inferred.
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          className="mt-dpf-md"
          title="No managed products in this line"
          description="Add a real product to the product mix before comparing performance."
        />
      ) : (
        <ul className="mt-dpf-md grid gap-dpf-md lg:grid-cols-2">
          {rows.map((row) => (
            <li
              key={row.productId}
              className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
            >
              <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
                <div>
                  <Link
                    href={row.href}
                    className="text-dpf-body-lg font-dpf-semibold text-[var(--dpf-accent)] hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
                    {row.semanticId}
                  </p>
                </div>
                <StatusBadge
                  intent={row.saleCount > 0 ? "success" : "neutral"}
                  label={
                    row.saleCount > 0
                      ? `${row.saleCount} recorded ${row.saleCount === 1 ? "sale" : "sales"}`
                      : "No sales evidence"
                  }
                  uppercase={false}
                />
              </div>
              {row.saleCount > 0 ? (
                <p className="mt-dpf-md text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
                  {formatMoney(row.additiveRevenue, row.currency)}
                </p>
              ) : null}
              {row.unallocatedComponentCount > 0 ? (
                <Notice variant="warn" className="mt-dpf-md">
                  {row.unallocatedComponentCount} bundle{" "}
                  {row.unallocatedComponentCount === 1 ? "component" : "components"}{" "}
                  lack allocation evidence.
                </Notice>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
