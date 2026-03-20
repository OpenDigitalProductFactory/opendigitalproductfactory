// apps/web/app/(shell)/finance/invoices/[id]/page.tsx
import { getInvoice } from "@/lib/actions/finance";
import Link from "next/link";
import { notFound } from "next/navigation";

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
          className="text-xs text-[var(--dpf-muted)] hover:text-white"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/invoices"
          className="text-xs text-[var(--dpf-muted)] hover:text-white"
        >
          Invoices
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-white">{invoice.invoiceRef}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-white">
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
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white">
            £{formatMoney(totalAmount)}
          </p>
          {amountDue !== totalAmount && (
            <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
              Due: £{formatMoney(amountDue)}
            </p>
          )}
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Issue Date</p>
          <p className="text-sm font-semibold text-white">
            {new Date(invoice.issueDate).toLocaleDateString("en-GB")}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Due Date</p>
          <p className="text-sm font-semibold text-white">
            {new Date(invoice.dueDate).toLocaleDateString("en-GB")}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Terms</p>
          <p className="text-sm font-semibold text-white">
            {invoice.paymentTerms ?? "—"}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Type</p>
          <p className="text-sm font-semibold text-white capitalize">
            {invoice.type}
          </p>
        </div>
      </div>

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
                  <td className="px-4 py-2.5 text-white">{item.description}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {Number(item.quantity)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    £{formatMoney(Number(item.unitPrice))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {Number(item.taxRate)}%
                  </td>
                  <td className="px-4 py-2.5 text-right text-white">
                    £{formatMoney(Number(item.lineTotal))}
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
                <td className="px-4 py-2 text-right text-white">
                  £{formatMoney(subtotal)}
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
                    £{formatMoney(taxAmount)}
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
                <td className="px-4 py-2 text-right text-white font-bold">
                  £{formatMoney(totalAmount)}
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
                      {alloc.payment.receivedAt
                        ? new Date(alloc.payment.receivedAt).toLocaleDateString(
                            "en-GB"
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#4ade80]">
                      £{formatMoney(Number(alloc.amount))}
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
          <p className="text-sm text-white whitespace-pre-wrap">
            {invoice.notes}
          </p>
        </section>
      )}
    </div>
  );
}
