// apps/web/app/(shell)/finance/suppliers/new/page.tsx
import Link from "next/link";
import { CreateSupplierForm } from "@/components/finance/CreateSupplierForm";

export default function NewSupplierPage() {
  return (
    <div>
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/suppliers" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Suppliers
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">New Supplier</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">Add Supplier</h1>

      <div className="max-w-2xl">
        <CreateSupplierForm />
      </div>
    </div>
  );
}
