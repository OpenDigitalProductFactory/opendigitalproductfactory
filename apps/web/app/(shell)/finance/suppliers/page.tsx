// apps/web/app/(shell)/finance/suppliers/page.tsx
import { listSuppliers } from "@/lib/actions/ap";
import Link from "next/link";

const SUPPLIER_STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  inactive: "#8888a0",
  blocked: "#ef4444",
};

export default async function SuppliersPage() {
  const suppliers = await listSuppliers();

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-white">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-white">Suppliers</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-white">Suppliers</h1>
        <Link
          href="/finance/suppliers/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Supplier
        </Link>
      </div>

      {suppliers.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No suppliers yet.</p>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  ID
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Name
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Status
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Payment Terms
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Bills
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const colour = SUPPLIER_STATUS_COLOURS[s.status] ?? "#6b7280";
                return (
                  <tr
                    key={s.id}
                    className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/finance/suppliers/${s.id}`}
                        className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-white transition-colors"
                      >
                        {s.supplierId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/finance/suppliers/${s.id}`}
                        className="text-white hover:underline"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{
                          color: colour,
                          backgroundColor: `${colour}20`,
                        }}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {s.paymentTerms}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                      {s._count.bills}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
