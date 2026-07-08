// apps/web/app/(shell)/finance/suppliers/page.tsx
import { listSuppliers } from "@/lib/actions/ap";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { SurfaceViewSwitcher } from "@/components/workbooks/SurfaceViewSwitcher";
import { SurfacePlatformGrid } from "@/components/workbooks/SurfacePlatformGrid";
import Link from "next/link";
import { SuppliersTable, type SupplierRow } from "./SuppliersTable";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view = sp?.view === "grid" || sp?.view === "board" ? sp.view : null;
  const suppliers = await listSuppliers();

  const rows: SupplierRow[] = suppliers.map((s) => ({
    id: s.id,
    supplierId: s.supplierId,
    name: s.name,
    status: s.status,
    paymentTerms: s.paymentTerms,
    billCount: s._count.bills,
  }));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Suppliers</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Suppliers</h1>
        <Link
          href="/finance/suppliers/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Supplier
        </Link>
      </div>

      <FinanceTabNav />

      <SurfaceViewSwitcher entityType="supplier" current={view ?? "list"} />

      {view ? (
        <SurfacePlatformGrid entityType="supplier" view={view} />
      ) : (
        <SuppliersTable rows={rows} />
      )}
    </div>
  );
}
