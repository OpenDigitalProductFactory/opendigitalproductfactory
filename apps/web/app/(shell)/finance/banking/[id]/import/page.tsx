// apps/web/app/(shell)/finance/banking/[id]/import/page.tsx
import { getBankAccount } from "@/lib/actions/banking";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ImportCSVForm } from "@/components/finance/ImportCSVForm";

type Props = { params: Promise<{ id: string }> };

export default async function ImportStatementPage({ params }: Props) {
  const { id } = await params;
  const account = await getBankAccount(id);
  if (!account) notFound();

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/banking"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Banking
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href={`/finance/banking/${id}`}
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          {account.name}
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Import Statement</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Import Statement</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Upload a CSV bank statement to import transactions into{" "}
          <span className="text-[var(--dpf-text)]">{account.name}</span>
        </p>
      </div>

      <ImportCSVForm bankAccountId={id} accountName={account.name} />
    </div>
  );
}
