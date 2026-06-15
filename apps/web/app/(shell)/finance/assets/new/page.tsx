// apps/web/app/(shell)/finance/assets/new/page.tsx
import { CreateAssetForm } from "@/components/finance/CreateAssetForm";
import { getOrgSettings } from "@/lib/actions/currency";
import Link from "next/link";

export default async function NewAssetPage() {
  const orgSettings = await getOrgSettings();

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
        <CreateAssetForm defaultCurrency={orgSettings.baseCurrency} />
      </div>
    </div>
  );
}
