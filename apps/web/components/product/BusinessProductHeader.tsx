import Link from "next/link";
import type { BusinessProductRouteRecord } from "@/lib/product-management/product-route-authority";

export function BusinessProductHeader({
  product,
}: {
  product: BusinessProductRouteRecord;
}) {
  return (
    <header className="mb-dpf-md">
      <nav
        aria-label="Breadcrumb"
        className="mb-dpf-md flex flex-wrap items-center gap-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]"
      >
        <Link href="/portfolio" className="hover:text-[var(--dpf-text)]">
          Products
        </Link>
        <span aria-hidden="true">›</span>
        <Link
          href={`/portfolio/product-line/${product.productLine.id}/direction`}
          className="hover:text-[var(--dpf-text)]"
        >
          {product.productLine.name}
        </Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="text-[var(--dpf-text)]">
          {product.name}
        </span>
      </nav>
      <div className="flex flex-wrap items-center gap-dpf-sm">
        <h1 className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
          {product.name}
        </h1>
        <span className="rounded-dpf-sm border border-[var(--dpf-border)] px-dpf-sm py-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
          Business product
        </span>
      </div>
      <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
        {product.productId} · {product.productLine.name} · Provided by{" "}
        {product.organization.name}
      </p>
      {product.description ? (
        <p className="mt-dpf-sm max-w-prose text-dpf-body text-[var(--dpf-text)]">
          {product.description}
        </p>
      ) : null}
    </header>
  );
}
