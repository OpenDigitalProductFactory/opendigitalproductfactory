// apps/web/app/(shell)/finance/payment-runs/page.tsx
import { listPaymentRuns, listBills } from "@/lib/actions/ap";
import { PaymentRunBuilder } from "@/components/finance/PaymentRunBuilder";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import Link from "next/link";
import { PaymentRunsTable, type PaymentRunRow } from "./PaymentRunsTable";

export default async function PaymentRunsPage() {
  const [runs, approvedBills] = await Promise.all([
    listPaymentRuns(),
    listBills({ status: "approved" }),
  ]);

  const runRows: PaymentRunRow[] = runs.map((run) => ({
    id: run.id,
    paymentRef: run.paymentRef,
    receivedAtISO: run.receivedAt ? new Date(run.receivedAt).toISOString() : null,
    status: run.status,
    billCount: run.allocations.length,
    currency: run.currency,
    amount: Number(run.amount),
  }));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Payment Runs</span>
      </div>

      <h1 className="text-xl font-bold text-[var(--dpf-text)] mb-6">Payment Runs</h1>

      <FinanceTabNav />

      {/* New Payment Run Builder */}
      <section className="mb-10">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-4">
          New Payment Run
        </h2>
        <PaymentRunBuilder
          approvedBills={approvedBills.map((b) => ({
            id: b.id,
            billRef: b.billRef,
            supplierId: b.supplierId,
            supplierName: b.supplier.name,
            currency: b.currency,
            amountDue: Number(b.amountDue),
          }))}
        />
      </section>

      {/* Past payment runs */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Past Payment Runs
        </h2>

        <PaymentRunsTable rows={runRows} />
      </section>
    </div>
  );
}
