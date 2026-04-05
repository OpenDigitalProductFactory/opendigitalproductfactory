// apps/web/components/portfolio/ProductList.tsx
import Link from "next/link";

type Product = {
  id: string;
  productId: string;
  name: string;
  lifecycleStatus: string;
};

type Props = {
  products: Product[];
  colour: string;
  className?: string;
};

const STATUS_COLOURS: Record<string, string> = {
  active:   "var(--dpf-success)",
  draft:    "var(--dpf-warning)",
  inactive: "var(--dpf-muted)",
};

export function ProductList({ products, colour, className = "" }: Props) {
  return (
    <div className={className}>
      <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
        Digital Products &amp; Services
      </p>
      <div className="flex flex-col gap-2">
        {products.map((product) => {
          const statusColour = STATUS_COLOURS[product.lifecycleStatus] ?? "var(--dpf-muted)";
          return (
            <Link
              key={product.id}
              href={`/portfolio/product/${product.id}`}
              className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg px-3 py-2.5 block hover:border-[var(--dpf-text)] transition-colors"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium text-[var(--dpf-text)]">{product.name}</span>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: `color-mix(in srgb, ${statusColour} 12%, transparent)`, color: statusColour }}
                >
                  {product.lifecycleStatus}
                </span>
              </div>
              <p className="text-[10px] text-[var(--dpf-muted)]">{product.productId}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
