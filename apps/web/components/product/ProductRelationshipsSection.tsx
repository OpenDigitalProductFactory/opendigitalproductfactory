import Link from "next/link";
import { Surface } from "@/components/ui/Surface";

export type ProductRelationshipRow = {
  id: string;
  relationType: string;
  source: string | null;
  fromProduct: { id: string; name: string };
  toProduct: { id: string; name: string };
};

export function ProductRelationshipsSection({
  productId,
  relationships,
}: {
  productId: string;
  relationships: ProductRelationshipRow[];
}) {
  const outgoing = relationships.filter((row) => row.fromProduct.id === productId);
  const incoming = relationships.filter((row) => row.toProduct.id === productId);

  return (
    <section aria-labelledby="product-relationships-heading" className="space-y-3">
      <div>
        <h2 id="product-relationships-heading" className="text-lg font-semibold text-[var(--dpf-text)]">
          Product relationships
        </h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Portfolio relationships show which products this product relies on and which products rely on it.
        </p>
      </div>

      {relationships.length === 0 ? (
        <Surface rounded="xl" className="border-dashed text-sm text-[var(--dpf-muted)]">
          No product relationships recorded yet.
        </Surface>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <RelationshipList label="Depends on" rows={outgoing} productId={productId} />
          <RelationshipList label="Depended on by" rows={incoming} productId={productId} />
        </div>
      )}
    </section>
  );
}

function RelationshipList({
  label,
  rows,
  productId,
}: {
  label: string;
  rows: ProductRelationshipRow[];
  productId: string;
}) {
  return (
    <Surface rounded="xl">
      <p className="text-dpf-caption font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--dpf-muted)]">None recorded.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const related = row.fromProduct.id === productId ? row.toProduct : row.fromProduct;
            return (
              <li key={row.id} className="flex items-center justify-between gap-3 text-sm">
                <Link className="font-medium text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]" href={`/portfolio/product/${related.id}`}>
                  {related.name}
                </Link>
                <span className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-dpf-caption text-[var(--dpf-muted)]">
                  {row.relationType.replaceAll("_", " ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}
