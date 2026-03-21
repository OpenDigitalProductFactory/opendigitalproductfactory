// apps/web/app/(shell)/finance/purchase-orders/new/page.tsx
import { listSuppliers } from "@/lib/actions/ap";
import { CreatePOForm } from "@/components/finance/CreatePOForm";
import Link from "next/link";

type Props = { searchParams: Promise<{ supplierId?: string }> };

export default async function NewPOPage({ searchParams }: Props) {
  const { supplierId } = await searchParams;

  const suppliers = await listSuppliers();

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/purchase-orders"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Purchase Orders
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">New PO</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">New Purchase Order</h1>

      <div className="max-w-3xl">
        <CreatePOForm
          suppliers={suppliers.map((s) => ({
            id: s.id,
            supplierId: s.supplierId,
            name: s.name,
            defaultCurrency: s.defaultCurrency,
          }))}
          defaultSupplierId={supplierId}
        />
      </div>
    </div>
  );
}
