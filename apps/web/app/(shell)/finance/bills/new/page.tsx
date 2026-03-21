// apps/web/app/(shell)/finance/bills/new/page.tsx
import { listSuppliers, listPurchaseOrders } from "@/lib/actions/ap";
import { CreateBillForm } from "@/components/finance/CreateBillForm";
import Link from "next/link";

type Props = { searchParams: Promise<{ supplierId?: string }> };

export default async function NewBillPage({ searchParams }: Props) {
  const { supplierId } = await searchParams;

  const [suppliers, purchaseOrders] = await Promise.all([
    listSuppliers(),
    listPurchaseOrders(),
  ]);

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
        <span className="text-xs text-[var(--dpf-text)]">New Bill</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">New Bill</h1>

      <div className="max-w-3xl">
        <CreateBillForm
          suppliers={suppliers.map((s) => ({
            id: s.id,
            supplierId: s.supplierId,
            name: s.name,
            defaultCurrency: s.defaultCurrency,
          }))}
          purchaseOrders={purchaseOrders.map((po) => ({
            id: po.id,
            poNumber: po.poNumber,
            supplierId: po.supplierId,
            lineItems: po.lineItems,
          }))}
          defaultSupplierId={supplierId}
        />
      </div>
    </div>
  );
}
