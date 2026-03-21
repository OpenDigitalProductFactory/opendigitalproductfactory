// apps/web/app/(shell)/finance/bills/[id]/page.tsx
import { getBill } from "@/lib/actions/ap";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SubmitBillButton } from "@/components/finance/SubmitBillButton";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  awaiting_approval: "#a78bfa",
  approved: "#38bdf8",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
};

const APPROVAL_STATUS_COLOURS: Record<string, string> = {
  pending: "#fbbf24",
  approved: "#4ade80",
  rejected: "#ef4444",
};

type Props = { params: Promise<{ id: string }> };

export default async function BillDetailPage({ params }: Props) {
  const { id } = await params;
  const bill = await getBill(id);
  if (!bill) notFound();

  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const statusColour = STATUS_COLOURS[bill.status] ?? "#6b7280";
  const formatMoney = (amount: unknown) =>
    Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/bills" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Bills
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{bill.billRef}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-[var(--dpf-text)]">{bill.billRef}</h1>
            <span
              className="text-[9px] px-2 py-0.5 rounded-full"
              style={{ color: statusColour, backgroundColor: `${statusColour}20` }}
            >
              {bill.status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-sm text-[var(--dpf-muted)]">{bill.supplier.name}</p>
        </div>
        {bill.status === "draft" && <SubmitBillButton billId={bill.id} />}
      </div>

      {/* Metadata row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Issue Date", value: new Date(bill.issueDate).toLocaleDateString("en-GB") },
          { label: "Due Date", value: new Date(bill.dueDate).toLocaleDateString("en-GB") },
          { label: "Currency", value: bill.currency },
          { label: "Invoice Ref", value: bill.invoiceRef ?? "—" },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          >
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">{label}</p>
            <p className="text-sm text-[var(--dpf-text)]">{value}</p>
          </div>
        ))}
      </div>

      {/* Line items */}
      <section className="mb-8">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Line Items
        </h2>
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Description</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Qty</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Unit Price</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Tax %</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {bill.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-[var(--dpf-border)] last:border-0">
                  <td className="px-4 py-2.5 text-[var(--dpf-text)]">{li.description}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">{Number(li.quantity)}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {sym}{formatMoney(li.unitPrice)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {Number(li.taxRate)}%
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                    {sym}{formatMoney(li.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--dpf-border)]">
                <td colSpan={4} className="px-4 py-2.5 text-right text-[var(--dpf-muted)] text-[10px] uppercase tracking-widest">
                  Subtotal
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">{sym}{formatMoney(bill.subtotal)}</td>
              </tr>
              {Number(bill.taxAmount) > 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-right text-[var(--dpf-muted)] text-[10px] uppercase tracking-widest">
                    Tax
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">{sym}{formatMoney(bill.taxAmount)}</td>
                </tr>
              )}
              <tr className="border-t border-[var(--dpf-border)]">
                <td colSpan={4} className="px-4 py-2.5 text-right text-[var(--dpf-text)] text-[10px] uppercase tracking-widest font-semibold">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--dpf-text)] font-bold">
                  {sym}{formatMoney(bill.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Approval timeline */}
      {bill.approvals.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Approval Timeline
          </h2>
          <div className="flex flex-col gap-2">
            {bill.approvals.map((approval) => {
              const colour = APPROVAL_STATUS_COLOURS[approval.status] ?? "#6b7280";
              return (
                <div
                  key={approval.id}
                  className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] flex items-start justify-between gap-4"
                >
                  <div>
                    <p className="text-sm text-[var(--dpf-text)]">{approval.approver.email}</p>
                    {approval.comments && (
                      <p className="text-xs text-[var(--dpf-muted)] mt-1">{approval.comments}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ color: colour, backgroundColor: `${colour}20` }}
                    >
                      {approval.status}
                    </span>
                    {approval.respondedAt && (
                      <p className="text-[9px] text-[var(--dpf-muted)]">
                        {new Date(approval.respondedAt).toLocaleDateString("en-GB")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Payment allocations */}
      {bill.allocations.length > 0 && (
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Payment Allocations
          </h2>
          <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Payment Ref</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {bill.allocations.map((alloc) => (
                  <tr key={alloc.id} className="border-b border-[var(--dpf-border)] last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                        {alloc.payment.paymentRef}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                      {sym}{formatMoney(alloc.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
