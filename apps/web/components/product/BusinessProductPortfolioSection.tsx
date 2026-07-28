import Link from "next/link";
import { cookies } from "next/headers";
import { EmptyState, StatusBadge } from "@/components/ui/report-kit";
import {
  loadCurrentProductOperatingContextByKey,
  requireCurrentProductManagementOrganization,
} from "@/lib/product-management/current-product-operating-context.server";
import {
  buildProductPortfolioHierarchy,
  type ProductLinePortfolioNode,
} from "@/lib/product-management/product-line-direction-view";
import {
  NAV_MODE_COOKIE,
  resolveNavModeFromCookie,
} from "@/lib/navigation/nav-mode";

function formatMoney(value: number, currency: string | null): string {
  if (!currency) return "Mixed currencies";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function ProductLineNode({
  node,
  professional,
}: {
  node: ProductLinePortfolioNode;
  professional: boolean;
}) {
  const body = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
        <div>
          <Link
            href={`/portfolio/product-line/${node.id}/direction`}
            className="text-dpf-body-lg font-dpf-semibold text-[var(--dpf-accent)] hover:underline"
          >
            {node.name}
          </Link>
          <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
            {node.totalProductCount === 0
              ? "No managed products"
              : `${node.totalProductCount} managed ${
                  node.totalProductCount === 1 ? "product" : "products"
                }`}
            {node.directProductCount !== node.totalProductCount
              ? ` · ${node.directProductCount} directly in this line`
              : ""}
          </p>
        </div>
        <StatusBadge
          intent={node.saleCount > 0 ? "success" : "neutral"}
          uppercase={false}
          label={
            node.saleCount > 0
              ? `${node.saleCount} recorded ${node.saleCount === 1 ? "sale" : "sales"}`
              : "No sales evidence"
          }
        />
      </div>
      {node.saleCount > 0 ? (
        <p className="mt-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
          {formatMoney(node.additiveRevenue, node.currency)} additive revenue
        </p>
      ) : null}
    </>
  );

  return (
    <li className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-md">
      {body}
      {node.children.length > 0 ? (
        <details open={professional} data-dpf-disclosure className="mt-dpf-md">
          <summary className="cursor-pointer text-dpf-body font-dpf-medium text-[var(--dpf-accent)]">
            Child product lines ({node.children.length})
          </summary>
          <ul className="mt-dpf-md space-y-dpf-sm border-l border-[var(--dpf-border)] pl-dpf-md">
            {node.children.map((child) => (
              <ProductLineNode
                key={child.id}
                node={child}
                professional={professional}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

export async function BusinessProductPortfolioSection() {
  const organization = await requireCurrentProductManagementOrganization();
  const [context, cookieStore] = await Promise.all([
    loadCurrentProductOperatingContextByKey(
      "organization",
      organization.id,
      "commercial-summary",
    ),
    cookies(),
  ]);
  const hierarchy = buildProductPortfolioHierarchy(context);
  const navMode = resolveNavModeFromCookie(
    cookieStore.get(NAV_MODE_COOKIE)?.value,
  );
  const professional = navMode === "operator";

  return (
    <section
      aria-labelledby="business-product-portfolio"
      data-portfolio-slug="products_and_services_sold"
      className="mb-dpf-xl"
    >
      <div>
        <h2
          id="business-product-portfolio"
          className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]"
        >
          Goods and Services for Sale
        </h2>
        <p className="mt-dpf-2xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
          Browse the business product lines {organization.name} provides. Digital
          architecture remains in the existing portfolio view below.
        </p>
      </div>
      {hierarchy.length === 0 ? (
        <EmptyState
          className="mt-dpf-md"
          title="Define what the business sells"
          description="Choose the main product line during Storefront setup. Add adjacent lines only when the business really sells them."
          action={
            <Link
              href="/storefront/setup"
              data-dpf-primary-action
              className="rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-on-accent,var(--dpf-surface-1))]"
            >
              Set up the product mix
            </Link>
          }
        />
      ) : (
        <ul className="mt-dpf-md grid gap-dpf-md xl:grid-cols-2">
          {hierarchy.map((node) => (
            <ProductLineNode
              key={node.id}
              node={node}
              professional={professional}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
