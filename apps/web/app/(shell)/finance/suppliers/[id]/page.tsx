// apps/web/app/(shell)/finance/suppliers/[id]/page.tsx
import { getSupplier } from "@/lib/actions/ap";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getAiSupplierFinanceDetail } from "@/lib/finance/ai-provider-finance";
import { AiSupplierFinancePanel } from "@/components/finance/AiSupplierFinancePanel";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";

type Props = { params: Promise<{ id: string }> };

export default async function SupplierDetailPage({ params }: Props) {
  const { id } = await params;
  const supplier = await getSupplier(id);
  if (!supplier) notFound();
  const supplierFinance = await getAiSupplierFinanceDetail(supplier.id);

  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

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
        <Link href="/finance/suppliers" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Suppliers
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{supplier.name}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{supplier.name}</h1>
          <p className="text-[10px] font-mono text-[var(--dpf-muted)] mt-0.5">
            {supplier.supplierId}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/finance/bills/new?supplierId=${supplier.id}`}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-[var(--dpf-on-accent)] hover:opacity-90 transition-opacity"
          >
            New Bill
          </Link>
          <Link
            href={`/finance/purchase-orders/new?supplierId=${supplier.id}`}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] hover:border-[var(--dpf-border-strong)] transition-colors"
          >
            New PO
          </Link>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Contact", value: supplier.contactName ?? "—" },
          { label: "Email", value: supplier.email ?? "—" },
          { label: "Phone", value: supplier.phone ?? "—" },
          { label: "Tax ID", value: supplier.taxId ?? "—" },
          { label: "Payment Terms", value: supplier.paymentTerms },
          { label: "Currency", value: supplier.defaultCurrency },
        ].map(({ label, value }) => (
          <Surface key={label}>
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">
              {label}
            </p>
            <p className="text-sm text-[var(--dpf-text)]">{value}</p>
          </Surface>
        ))}
      </div>

      <AiSupplierFinancePanel detail={supplierFinance} />

      {/* Recent Bills */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Recent Bills ({supplier._count.bills})
          </h2>
          <Link
            href={`/finance/bills?supplierId=${supplier.id}`}
            className="text-[10px] text-[var(--dpf-accent)] hover:underline"
          >
            View all →
          </Link>
        </div>

        {supplier.bills.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No bills yet.</p>
        ) : (
          <Surface padding="none" className="overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Ref</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Status</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Due</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {supplier.bills.map((bill) => {
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
                        <StatusBadge
                          domain="financeBill"
                          status={bill.status}
                          label={bill.status.replace(/_/g, " ")}
                          variant="soft"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                        <LocalTime value={bill.dueDate} utc />
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                        {sym}{formatMoney(bill.totalAmount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Surface>
        )}
      </section>

      {/* Recent Purchase Orders */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Recent Purchase Orders ({supplier._count.purchaseOrders})
          </h2>
          <Link
            href={`/finance/purchase-orders?supplierId=${supplier.id}`}
            className="text-[10px] text-[var(--dpf-accent)] hover:underline"
          >
            View all →
          </Link>
        </div>

        {supplier.purchaseOrders.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No purchase orders yet.</p>
        ) : (
          <Surface padding="none" className="overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">PO Number</th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Status</th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {supplier.purchaseOrders.map((po) => {
                  return (
                    <tr
                      key={po.id}
                      className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/finance/purchase-orders/${po.id}`}
                          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                        >
                          {po.poNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          domain="financePurchaseOrder"
                          status={po.status}
                          label={po.status.replace(/_/g, " ")}
                          variant="soft"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                        {sym}{formatMoney(po.totalAmount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Surface>
        )}
      </section>
    </div>
  );
}
