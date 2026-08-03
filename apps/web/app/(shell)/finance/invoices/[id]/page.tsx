// apps/web/app/(shell)/finance/invoices/[id]/page.tsx
import { getInvoice } from "@/lib/actions/finance";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceSendButton } from "@/components/finance/InvoiceSendButton";
import { InvoiceDownloadButton } from "@/components/finance/InvoiceDownloadButton";
import { RecordInvoicePaymentButton } from "@/components/finance/RecordInvoicePaymentButton";
import { InvoiceSignatureToggle } from "@/components/finance/InvoiceSignatureToggle";
import { InvoiceLifecycleActions } from "@/components/finance/InvoiceLifecycleActions";
import { InvoiceDocumentHistory } from "@/components/finance/InvoiceDocumentHistory";
import { LocalTime } from "@/components/ui/LocalTime";
import { prisma } from "@dpf/db";
import {
  checkInvoiceDeletion,
  checkInvoiceTransition,
  describeInvoiceDeletionConsequences,
  describeInvoiceVoidConsequences,
  type InvoiceStatus,
} from "@/lib/finance/invoice-lifecycle";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  sent: "#38bdf8",
  viewed: "#a78bfa",
  overdue: "#ef4444",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
  written_off: "#6b7280",
};

type Props = { params: Promise<{ id: string }> };

export default async function InvoiceDetailPage({ params }: Props) {
  const { id } = await params;

  let invoice;
  try {
    invoice = await getInvoice(id);
  } catch {
    notFound();
  }

  if (!invoice) {
    notFound();
  }

  // Gates are evaluated here so the controls can explain THEMSELVES rather than
  // only failing on click. The actions re-check server-side regardless.
  const [allocationCount, dunningCount, journalEntryCount, timesheetEntryCount] = await Promise.all([
    prisma.paymentAllocation.count({ where: { invoiceId: invoice.id } }),
    prisma.dunningLog.count({ where: { invoiceId: invoice.id } }),
    prisma.journalEntry.count({ where: { sourceType: "Invoice", sourceId: invoice.id } }),
    prisma.timesheetEntry.count({ where: { invoiceId: invoice.id } }),
  ]);

  const deletion = checkInvoiceDeletion({
    status: invoice.status as InvoiceStatus,
    allocationCount,
    dunningCount,
    journalEntryCount,
  });
  const voiding = checkInvoiceTransition(invoice.status as InvoiceStatus, "void");
  const consequenceFacts = {
    lineItemCount: invoice.lineItems.length,
    timesheetEntryCount,
    journalEntryCount,
    allocationCount,
  };

  const sym = getCurrencySymbol(invoice.currency);

  const colour = STATUS_COLOURS[invoice.status] ?? "#6b7280";
  const totalAmount = Number(invoice.totalAmount);
  const amountDue = Number(invoice.amountDue);
  const subtotal = Number(invoice.subtotal);
  const taxAmount = Number(invoice.taxAmount);

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/invoices"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Invoices
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{invoice.invoiceRef}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[var(--dpf-text)]">
              {invoice.invoiceRef}
            </h1>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={{
                color: colour,
                backgroundColor: `${colour}20`,
              }}
            >
              {invoice.status.replace("_", " ")}
            </span>
          </div>
          <p className="text-sm text-[var(--dpf-muted)]">
            {invoice.account.name}
          </p>
          {/* Action buttons */}
          <div className="flex gap-2 mt-3">
            <InvoiceDownloadButton invoiceId={invoice.id} />
            <InvoiceSendButton invoiceId={invoice.id} status={invoice.status} customerAccountId={invoice.account.id} />
            <RecordInvoicePaymentButton
              invoiceId={invoice.id}
              outstanding={amountDue}
              currency={invoice.currency}
              status={invoice.status}
            />
            {/* Destructive actions sit after a divider so they are not adjacent to Send. */}
            <span aria-hidden="true" className="w-px self-stretch bg-[var(--dpf-border)] mx-1" />
            <InvoiceLifecycleActions
              invoiceId={invoice.id}
              status={invoice.status}
              canDelete={deletion.allowed}
              deleteBlockedReason={deletion.allowed ? null : deletion.reason}
              canVoid={voiding.allowed}
              voidBlockedReason={voiding.allowed ? null : voiding.reason}
              deleteConsequences={describeInvoiceDeletionConsequences(consequenceFacts)}
              voidConsequences={describeInvoiceVoidConsequences(consequenceFacts)}
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-[var(--dpf-text)]">
            {sym}{formatMoney(totalAmount)}
          </p>
          {amountDue !== totalAmount && (
            <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
              Due: {sym}{formatMoney(amountDue)}
            </p>
          )}
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Issue Date</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">
            <LocalTime value={invoice.issueDate} utc />
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Due Date</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">
            <LocalTime value={invoice.dueDate} utc />
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Terms</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">
            {invoice.paymentTerms ?? "—"}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Type</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)] capitalize">
            {invoice.type}
          </p>
        </div>
      </div>

      {/* Signature status */}
      <section className="mb-6">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Signature
        </h2>
        <div className="rounded-lg border border-[var(--dpf-border)] p-4">
          {invoice.signedAt ? (
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-[var(--dpf-text)]">
                  Signed by{" "}
                  <span className="font-semibold">
                    {invoice.signedByName ?? invoice.signedByEmail ?? "—"}
                  </span>
                  {invoice.signedByEmail ? (
                    <span className="text-[var(--dpf-muted)]"> ({invoice.signedByEmail})</span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
                  <LocalTime value={invoice.signedAt} utc />
                </p>
              </div>
              {invoice.signatureDataUrl ? (
                // Captured signature is a data-URL PNG, so next/image can't optimise it.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={invoice.signatureDataUrl}
                  alt="Customer signature"
                  className="h-16 rounded border border-[var(--dpf-border)] bg-white"
                />
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-[var(--dpf-muted)]">
                {invoice.signatureRequired
                  ? "Signature required — awaiting the customer's signature on the payment page."
                  : "No signature required for this invoice."}
              </p>
              <InvoiceSignatureToggle
                invoiceId={invoice.id}
                signatureRequired={invoice.signatureRequired}
              />
            </div>
          )}
        </div>
      </section>

      {/* Persisted documents — what the customer actually received */}
      <InvoiceDocumentHistory invoiceId={invoice.id} />

      {/* Line items table */}
      <section className="mb-6">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Line Items
        </h2>
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Description
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Qty
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Unit Price
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Tax Rate
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[var(--dpf-border)] last:border-0"
                >
                  <td className="px-4 py-2.5 text-[var(--dpf-text)]">{item.description}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {Number(item.quantity)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {sym}{formatMoney(Number(item.unitPrice))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {Number(item.taxRate)}%
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                    {sym}{formatMoney(Number(item.lineTotal))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-[var(--dpf-border)]">
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-2 text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]"
                >
                  Subtotal
                </td>
                <td className="px-4 py-2 text-right text-[var(--dpf-text)]">
                  {sym}{formatMoney(subtotal)}
                </td>
              </tr>
              {taxAmount > 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-2 text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]"
                  >
                    Tax
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--dpf-muted)]">
                    {sym}{formatMoney(taxAmount)}
                  </td>
                </tr>
              )}
              <tr className="border-t border-[var(--dpf-border)]">
                <td
                  colSpan={4}
                  className="px-4 py-2 text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-semibold"
                >
                  Total
                </td>
                <td className="px-4 py-2 text-right text-[var(--dpf-text)] font-bold">
                  {sym}{formatMoney(totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Payment history */}
      {invoice.allocations.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Payment History
          </h2>
          <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Ref
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Method
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Date
                  </th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.allocations.map((alloc) => (
                  <tr
                    key={alloc.id}
                    className="border-b border-[var(--dpf-border)] last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                        {alloc.payment.paymentRef}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)] capitalize">
                      {alloc.payment.method}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {alloc.payment.receivedAt ? (
                        <LocalTime value={alloc.payment.receivedAt} mode="date" />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#4ade80]">
                      {sym}{formatMoney(Number(alloc.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Notes */}
      {invoice.notes && (
        <section className="mb-6">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Notes
          </h2>
          <p className="text-sm text-[var(--dpf-text)] whitespace-pre-wrap">
            {invoice.notes}
          </p>
        </section>
      )}
    </div>
  );
}
