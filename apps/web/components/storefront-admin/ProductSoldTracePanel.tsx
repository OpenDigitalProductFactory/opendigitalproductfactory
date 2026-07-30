import Link from "next/link";

import type { getCatalogItemProductSoldTrace } from "@/lib/products/product-sold-query";

export type ProductSoldTraceView = Awaited<
  ReturnType<typeof getCatalogItemProductSoldTrace>
>;

function formatMoney(amount: number, currency: string | null): string {
  if (!currency) return amount.toLocaleString();
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function readable(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function ProductSoldTracePanel({
  itemName,
  trace,
  backHref = "/storefront/items",
}: {
  itemName: string;
  trace: ProductSoldTraceView;
  backHref?: string;
}) {
  return (
    <div className="space-y-4" data-testid="product-sold-trace">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--dpf-muted)]">
            Customer purchases and use
          </p>
          <h1 className="text-xl font-semibold text-[var(--dpf-text)]">
            {itemName}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
            Follow real orders, bookings, and fulfillment without creating
            customer records that the evidence does not support.
          </p>
        </div>
        <Link
          href={backHref}
          className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--dpf-border)] px-3 text-sm text-[var(--dpf-text)]"
        >
          Back to sales options
        </Link>
      </div>

      {trace.records.length === 0 ? (
        <section className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
            No purchases to show yet
          </h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--dpf-muted)]">
            Purchases will appear after a catalog-linked order or booking. Older
            unlinked records stay in their original workflow until their product
            connection can be proven.
          </p>
        </section>
      ) : (
        <>
          <section
            aria-label="Purchase summary"
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
              <p className="text-xs text-[var(--dpf-muted)]">Purchases</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">
                {trace.saleCount}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
              <p className="text-xs text-[var(--dpf-muted)]">Charged total</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">
                {formatMoney(trace.additiveRevenue, trace.currency)}
              </p>
            </div>
          </section>

          <div className="space-y-3">
            {trace.records.map((record) => (
              <article
                key={record.productSoldId}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
                      {record.customer.label}
                    </h2>
                    {record.customer.email && (
                      <p className="text-xs text-[var(--dpf-muted)]">
                        {record.customer.email}
                      </p>
                    )}
                    {!record.customer.canonicalLinkEstablished && (
                      <p className="mt-1 text-xs text-[var(--dpf-warning)]">
                        Customer/account link not established
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">
                      {formatMoney(record.totalAmount, record.currency)}
                    </p>
                    <p className="text-xs text-[var(--dpf-muted)]">
                      {readable(record.status)} ·{" "}
                      {record.purchasedAt.toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <details className="mt-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
                  <summary className="min-h-[44px] cursor-pointer px-3 py-3 text-sm font-medium text-[var(--dpf-text)]">
                    More traceability
                  </summary>
                  <div className="space-y-4 border-t border-[var(--dpf-border)] px-3 py-3 text-xs text-[var(--dpf-muted)]">
                    <dl className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <dt>Product</dt>
                        <dd className="font-medium text-[var(--dpf-text)]">
                          {record.commercial.product.name}
                        </dd>
                      </div>
                      <div>
                        <dt>How it was offered</dt>
                        <dd className="font-medium text-[var(--dpf-text)]">
                          {record.commercial.offering.name}
                        </dd>
                      </div>
                      <div>
                        <dt>What was selected</dt>
                        <dd className="font-medium text-[var(--dpf-text)]">
                          {record.commercial.catalogItem.name}
                        </dd>
                      </div>
                      <div>
                        <dt>Trace ID</dt>
                        <dd className="font-mono text-[var(--dpf-text)]">
                          {record.productSoldId}
                        </dd>
                      </div>
                    </dl>

                    <div>
                      <h3 className="font-medium text-[var(--dpf-text)]">
                        Evidence
                      </h3>
                      <ul className="mt-1 space-y-1">
                        {record.evidence.map((evidence) => (
                          <li key={evidence.evidenceId}>
                            {readable(evidence.kind)}
                            {evidence.sourceRef
                              ? ` · ${evidence.sourceRef}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {record.fulfillmentInstances.length > 0 && (
                      <div>
                        <h3 className="font-medium text-[var(--dpf-text)]">
                          Fulfillment
                        </h3>
                        <ul className="mt-1 space-y-1">
                          {record.fulfillmentInstances.map((instance) => (
                            <li key={instance.instanceId}>
                              {readable(instance.instanceKind)} ·{" "}
                              {readable(instance.status)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {record.entitlements.length > 0 && (
                      <div>
                        <h3 className="font-medium text-[var(--dpf-text)]">
                          Access or usage rights
                        </h3>
                        <ul className="mt-1 space-y-1">
                          {record.entitlements.map((entitlement) => (
                            <li key={entitlement.entitlementId}>
                              {readable(entitlement.entitlementKind)} ·{" "}
                              {readable(entitlement.status)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {record.packageAllocations.length > 0 && (
                      <div>
                        <h3 className="font-medium text-[var(--dpf-text)]">
                          Included items
                        </h3>
                        <p>Component allocation, not additional revenue.</p>
                        <ul className="mt-1 space-y-1">
                          {record.packageAllocations.map((allocation) => (
                            <li key={allocation.catalogItemId}>
                              {allocation.name}
                              {allocation.allocatedAmount != null
                                ? ` · ${formatMoney(
                                    allocation.allocatedAmount,
                                    record.currency,
                                  )}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
