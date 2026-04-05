import Link from "next/link";

type Product = {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  lifecycleStage: string;
  lifecycleStatus: string;
  version: string;
  portfolio: { name: string; slug: string } | null;
  taxonomyNode: { name: string; nodeId: string } | null;
};

const STATUS_COLOURS: Record<string, string> = {
  active: "var(--dpf-success)",
  draft: "var(--dpf-warning)",
  inactive: "var(--dpf-muted)",
};

export function ProductHeader({ product }: { product: Product }) {
  const statusColour = STATUS_COLOURS[product.lifecycleStatus] ?? "var(--dpf-muted)";

  return (
    <div className="mb-4">
      {/* Breadcrumb */}
      <nav className="text-[11px] text-[var(--dpf-muted)] mb-4 flex gap-1.5 items-center">
        <Link href="/portfolio" className="text-[var(--dpf-muted)] no-underline hover:text-[var(--dpf-text)]">
          Portfolio
        </Link>
        {product.portfolio && (
          <>
            <span>&rsaquo;</span>
            <Link
              href={`/portfolio/${product.portfolio.slug}`}
              className="text-[var(--dpf-muted)] no-underline hover:text-[var(--dpf-text)]"
            >
              {product.portfolio.name}
            </Link>
          </>
        )}
        <span>&rsaquo;</span>
        <span className="text-[var(--dpf-text)]">{product.name}</span>
      </nav>

      {/* Product header */}
      <div className="flex items-center gap-2.5 mb-1">
        <h1 className="text-lg font-bold text-[var(--dpf-text)] m-0">{product.name}</h1>
        <span
          className="text-[10px] rounded px-2 py-0.5"
          style={{
            background: `color-mix(in srgb, ${statusColour} 12%, transparent)`,
            color: statusColour,
          }}
        >
          {product.lifecycleStatus}
        </span>
      </div>
      <p className="text-[11px] text-[var(--dpf-muted)] m-0">
        {product.productId} &middot; {product.lifecycleStage} &middot; v{product.version}
        {product.taxonomyNode && ` \u00b7 ${product.taxonomyNode.name}`}
      </p>
      {product.description && (
        <p className="text-xs text-[var(--dpf-text)] mt-2 max-w-[640px]">{product.description}</p>
      )}
    </div>
  );
}
