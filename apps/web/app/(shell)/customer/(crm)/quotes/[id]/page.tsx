// apps/web/app/(shell)/customer/quotes/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import { QuoteLifecycleActions } from "@/components/customer/QuoteLifecycleActions";
import { LocalTime } from "@/components/ui/LocalTime";
import {
  CRM_TONE_CLASSES,
  getOpportunityStageMeta,
  getQuoteStatusMeta,
} from "@/lib/crm/presentation";

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

function formatMoney(currency: string, value: unknown) {
  return `${currency} ${Number(value ?? 0).toLocaleString()}`;
}

function formatDiscount(
  currency: string,
  discountType: string,
  discountValue: unknown,
) {
  const value = Number(discountValue ?? 0);
  if (value === 0) return "None";
  return discountType === "percentage"
    ? `${value.toLocaleString()}%`
    : formatMoney(currency, value);
}

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params;
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      account: { select: { id: true, accountId: true, name: true } },
      opportunity: {
        select: { id: true, opportunityId: true, title: true, stage: true },
      },
      createdBy: { select: { email: true } },
      lineItems: {
        orderBy: { sortOrder: "asc" },
        include: { product: { select: { name: true } } },
      },
      salesOrder: {
        select: {
          id: true,
          orderRef: true,
          status: true,
          totalAmount: true,
          currency: true,
        },
      },
    },
  });

  if (!quote) notFound();

  const statusMeta = getQuoteStatusMeta(quote.status);
  const stageMeta = getOpportunityStageMeta(quote.opportunity.stage);
  const stageToneClasses = CRM_TONE_CLASSES[stageMeta.tone];

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Link
            href="/customer/quotes"
            className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            Back to quotes
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--dpf-text)]">
              {quote.quoteNumber}
            </h1>
            <span className="text-[10px] text-[var(--dpf-muted)]">
              v{quote.version}
            </span>
            <CustomerStatusBadge label={statusMeta.label} tone={statusMeta.tone} />
          </div>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            {quote.account.name} / {quote.opportunity.title}
          </p>
          <div className="mt-3">
            <QuoteLifecycleActions quoteId={quote.id} status={quote.status} />
          </div>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 md:text-right">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Total
          </p>
          <p className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
            {formatMoney(quote.currency, quote.totalAmount)}
          </p>
          <p className="mt-1 text-[10px] text-[var(--dpf-muted)]">
            Valid until <LocalTime value={quote.validUntil} utc />
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                Line items
              </h2>
              <span className="text-xs text-[var(--dpf-muted)]">
                {quote.lineItems.length} item{quote.lineItems.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {quote.lineItems.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 md:grid-cols-[minmax(0,1fr)_7rem_8rem]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--dpf-text)]">
                      {item.description}
                    </p>
                    {item.product ? (
                      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                        {item.product.name}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-xs text-[var(--dpf-muted)] md:text-right">
                    {item.quantity} x {formatMoney(quote.currency, item.unitPrice)}
                  </div>
                  <div className="text-sm font-semibold text-[var(--dpf-text)] md:text-right">
                    {formatMoney(quote.currency, item.lineTotal)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Terms and notes
            </h2>
            <dl className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                  Terms
                </dt>
                <dd className="mt-1 text-sm text-[var(--dpf-text)]">
                  {quote.terms || "No terms recorded."}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                  Notes
                </dt>
                <dd className="mt-1 text-sm text-[var(--dpf-text)]">
                  {quote.notes || "No notes recorded."}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Quote summary
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--dpf-muted)]">Subtotal</dt>
                <dd className="font-medium text-[var(--dpf-text)]">
                  {formatMoney(quote.currency, quote.subtotal)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--dpf-muted)]">Discount</dt>
                <dd className="font-medium text-[var(--dpf-text)]">
                  {formatDiscount(
                    quote.currency,
                    quote.discountType,
                    quote.discountValue,
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--dpf-muted)]">Tax</dt>
                <dd className="font-medium text-[var(--dpf-text)]">
                  {formatMoney(quote.currency, quote.taxAmount)}
                </dd>
              </div>
              <div className="border-t border-[var(--dpf-border)] pt-3">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--dpf-muted)]">Total</dt>
                  <dd className="font-semibold text-[var(--dpf-text)]">
                    {formatMoney(quote.currency, quote.totalAmount)}
                  </dd>
                </div>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Related opportunity
            </h2>
            <div className="mt-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
              <Link
                href={`/customer/opportunities?opportunity=${quote.opportunity.id}`}
                className="text-sm font-semibold text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]"
              >
                {quote.opportunity.title}
              </Link>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                {quote.opportunity.opportunityId}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span
                  className={[
                    "border-b-2 pb-1 text-xs font-semibold text-[var(--dpf-text)]",
                    stageToneClasses.border,
                  ].join(" ")}
                >
                  {stageMeta.label}
                </span>
                <span className="text-xs text-[var(--dpf-muted)]">
                  {quote.account.accountId}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Timeline
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-[var(--dpf-muted)]">Created</dt>
                <dd className="mt-1 text-[var(--dpf-text)]">
                  <LocalTime value={quote.createdAt} utc />
                  {quote.createdBy?.email ? ` by ${quote.createdBy.email}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--dpf-muted)]">Updated</dt>
                <dd className="mt-1 text-[var(--dpf-text)]">
                  <LocalTime value={quote.updatedAt} utc />
                </dd>
              </div>
              {quote.sentAt ? (
                <div>
                  <dt className="text-[var(--dpf-muted)]">Sent</dt>
                  <dd className="mt-1 text-[var(--dpf-text)]">
                    <LocalTime value={quote.sentAt} utc />
                  </dd>
                </div>
              ) : null}
              {quote.acceptedAt ? (
                <div>
                  <dt className="text-[var(--dpf-muted)]">Accepted</dt>
                  <dd className="mt-1 text-[var(--dpf-text)]">
                    <LocalTime value={quote.acceptedAt} utc />
                  </dd>
                </div>
              ) : null}
              {quote.rejectedAt ? (
                <div>
                  <dt className="text-[var(--dpf-muted)]">Rejected</dt>
                  <dd className="mt-1 text-[var(--dpf-text)]">
                    <LocalTime value={quote.rejectedAt} utc />
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          {quote.salesOrder ? (
            <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                Sales order
              </h2>
              <p className="mt-2 text-sm font-mono text-[var(--dpf-text)]">
                {quote.salesOrder.orderRef}
              </p>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                {quote.salesOrder.status} /{" "}
                {formatMoney(quote.salesOrder.currency, quote.salesOrder.totalAmount)}
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
