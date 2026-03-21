// apps/web/app/(shell)/finance/payment-runs/page.tsx
import { listPaymentRuns, listBills } from "@/lib/actions/ap";
import { PaymentRunBuilder } from "@/components/finance/PaymentRunBuilder";
import Link from "next/link";

export default async function PaymentRunsPage() {
  const [runs, approvedBills] = await Promise.all([
    listPaymentRuns(),
    listBills({ status: "approved" }),
  ]);

  const formatMoney = (amount: unknown) =>
    Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

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

        {runs.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No payment runs yet.</p>
        ) : (
          <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Payment Ref
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Date
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Status
                  </th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Bills
                  </th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const statusColour =
                    run.status === "completed"
                      ? "#4ade80"
                      : run.status === "failed"
                        ? "#ef4444"
                        : "#fbbf24";
                  return (
                    <tr
                      key={run.id}
                      className="border-b border-[var(--dpf-border)] last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                          {run.paymentRef}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                        {new Date(run.receivedAt).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{
                            color: statusColour,
                            backgroundColor: `${statusColour}20`,
                          }}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                        {run.allocations.length}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                        {run.currency} {formatMoney(run.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
