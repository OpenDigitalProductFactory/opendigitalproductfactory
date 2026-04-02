import Link from "next/link";

type InventoryEntity = {
  id: string;
  entityKey: string;
  name: string;
  entityType: string;
  status: string;
  attributionStatus: string;
  attributionMethod?: string | null;
  confidence?: number | null;
  attributionConfidence?: number | null;
  portfolio: { slug: string; name: string } | null;
  taxonomyNode: { nodeId: string; name: string } | null;
  digitalProduct: { id: string; productId: string; name: string } | null;
};

export function InventoryEntityPanel({
  entities,
}: {
  entities: InventoryEntity[];
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
            Operational Inventory
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">Discovered Assets</h2>
        </div>
        <span className="text-sm text-[var(--dpf-muted)]">{entities.length} entities</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {entities.map((entity) => {
          const confidence = entity.attributionConfidence ?? entity.confidence;

          return (
          <article
            key={entity.id}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--dpf-text)]">{entity.name}</p>
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
                  {entity.entityType}
                </p>
              </div>
              <span className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] text-[var(--dpf-muted)]">
                {entity.attributionStatus === "needs_review" ? "Review needed" : entity.attributionStatus}
              </span>
            </div>

            <p className="mt-3 text-[11px] font-mono text-[var(--dpf-muted)]">{entity.entityKey}</p>

            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-[var(--dpf-muted)]">
              {entity.portfolio && <span>Portfolio: {entity.portfolio.name}</span>}
              {entity.taxonomyNode && (
                <span>Taxonomy: {entity.taxonomyNode.nodeId.replace(/\//g, " / ")}</span>
              )}
              {entity.digitalProduct && (
                <Link
                  href={`/portfolio/product/${entity.digitalProduct.id}/inventory`}
                  className="text-[var(--dpf-accent)] hover:underline"
                >
                  Product: {entity.digitalProduct.name}
                </Link>
              )}
              <span>Status: {entity.status}</span>
              {entity.attributionMethod && <span>Method: {entity.attributionMethod}</span>}
              {confidence != null && (
                <span>{Math.round(confidence * 100)}% confidence</span>
              )}
            </div>
          </article>
          );
        })}
      </div>

      {entities.length === 0 && (
        <p className="mt-4 text-sm text-[var(--dpf-muted)]">
          No discovered infrastructure has been normalized yet.
        </p>
      )}
    </section>
  );
}
