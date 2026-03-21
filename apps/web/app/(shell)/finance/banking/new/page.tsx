// apps/web/app/(shell)/finance/banking/new/page.tsx
import Link from "next/link";
import { CreateBankAccountForm } from "@/components/finance/CreateBankAccountForm";

export default function NewBankAccountPage() {
  return (
    <div>
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/banking" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Banking
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">New Account</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">Add Bank Account</h1>

      <div className="max-w-2xl">
        <CreateBankAccountForm />
      </div>
    </div>
  );
}
