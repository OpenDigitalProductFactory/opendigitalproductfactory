// apps/web/app/(shell)/finance/assets/new/page.tsx
import { CreateAssetForm } from "@/components/finance/CreateAssetForm";
import Link from "next/link";

export default function NewAssetPage() {
  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/assets" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Assets
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">New Asset</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">Register Asset</h1>

      <div className="max-w-2xl">
        <CreateAssetForm />
      </div>
    </div>
  );
}
