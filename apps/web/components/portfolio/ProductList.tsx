// apps/web/components/portfolio/ProductList.tsx
type Product = {
  id: string;
  productId: string;
  name: string;
  status: string;
};

type Props = {
  products: Product[];
  colour: string;
  className?: string;
};

const STATUS_COLOURS: Record<string, string> = {
  active:  "#4ade80",
  review:  "#fb923c",
  retired: "#555566",
  idea:    "#a78bfa",
};

export function ProductList({ products, colour, className = "" }: Props) {
  return (
    <div className={className}>
      <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
        Digital Products &amp; Services
      </p>
      <div className="flex flex-col gap-2">
        {products.map((product) => {
          const statusColour = STATUS_COLOURS[product.status] ?? "#555566";
          return (
            <div
              key={product.id}
              className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg px-3 py-2.5"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium text-white">{product.name}</span>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: `${statusColour}20`, color: statusColour }}
                >
                  {product.status}
                </span>
              </div>
              <p className="text-[10px] text-[var(--dpf-muted)]">{product.productId}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
