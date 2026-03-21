// apps/web/app/(shell)/finance/purchase-orders/[id]/page.tsx
import { getPurchaseOrder } from "@/lib/actions/ap";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { notFound } from "next/navigation";
import Link from "next/link";
import { POActionButtons } from "@/components/finance/POActionButtons";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  sent: "#38bdf8",
  acknowledged: "#a78bfa",
  received: "#4ade80",
  cancelled: "#6b7280",
};

const BILL_STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  awaiting_approval: "#a78bfa",
  approved: "#38bdf8",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
};

type Props = { params: Promise<{ id: string }> };

export default async function PODetailPage({ params }: Props) {
  const { id } = await params;
  const po = await getPurchaseOrder(id);
  if (!po) notFound();

  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const statusColour = STATUS_COLOURS[po.status] ?? "#6b7280";
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
        <Link href="/finance/purchase-orders" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Purchase Orders
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{po.poNumber}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-[var(--dpf-text)]">{po.poNumber}</h1>
            <span
              className="text-[9px] px-2 py-0.5 rounded-full"
              style={{ color: statusColour, backgroundColor: `${statusColour}20` }}
            >
              {po.status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-sm text-[var(--dpf-muted)]">{po.supplier.name}</p>
        </div>
        <POActionButtons poId={po.id} status={po.status} />
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Currency", value: po.currency },
          {
            label: "Delivery Date",
            value: po.deliveryDate
              ? new Date(po.deliveryDate).toLocaleDateString("en-GB")
              : "—",
          },
          { label: "Terms", value: po.terms ?? "—" },
          {
            label: "Created",
            value: new Date(po.createdAt).toLocaleDateString("en-GB"),
          },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          >
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">
              {label}
            </p>
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
                  Tax %
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {po.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-[var(--dpf-border)] last:border-0">
                  <td className="px-4 py-2.5 text-[var(--dpf-text)]">{li.description}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {Number(li.quantity)}
                  </td>
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
                <td
                  colSpan={4}
                  className="px-4 py-2.5 text-right text-[var(--dpf-muted)] text-[10px] uppercase tracking-widest"
                >
                  Subtotal
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                  {sym}{formatMoney(po.subtotal)}
                </td>
              </tr>
              {Number(po.taxAmount) > 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-2.5 text-right text-[var(--dpf-muted)] text-[10px] uppercase tracking-widest"
                  >
                    Tax
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                    {sym}{formatMoney(po.taxAmount)}
                  </td>
                </tr>
              )}
              <tr className="border-t border-[var(--dpf-border)]">
                <td
                  colSpan={4}
                  className="px-4 py-2.5 text-right text-[var(--dpf-text)] text-[10px] uppercase tracking-widest font-semibold"
                >
                  Total
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--dpf-text)] font-bold">
                  {sym}{formatMoney(po.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Linked Bills */}
      {po.bills.length > 0 && (
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Linked Bills
          </h2>
          <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Bill Ref
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Status
                  </th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {po.bills.map((bill) => {
                  const colour = BILL_STATUS_COLOURS[bill.status] ?? "#6b7280";
                  return (
                    <tr
                      key={bill.id}
                      className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/finance/bills/${bill.id}`}
                          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                        >
                          {bill.billRef}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ color: colour, backgroundColor: `${colour}20` }}
                        >
                          {bill.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                        {sym}{formatMoney(bill.totalAmount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
