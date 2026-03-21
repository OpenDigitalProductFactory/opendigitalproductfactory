// apps/web/app/(shell)/finance/expense-claims/[id]/page.tsx
// Manager detail view for a single expense claim

import { getExpenseClaim } from "@/lib/actions/expenses";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ExpenseClaimActions } from "@/components/finance/ExpenseClaimActions";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  submitted: "#a78bfa",
  approved: "#4ade80",
  rejected: "#ef4444",
  paid: "#22c55e",
};

const CATEGORY_COLOURS: Record<string, string> = {
  travel: "#38bdf8",
  meals: "#fb923c",
  accommodation: "#a78bfa",
  supplies: "#4ade80",
  mileage: "#fbbf24",
  other: "#8888a0",
};

type Props = { params: Promise<{ id: string }> };

export default async function ExpenseClaimDetailPage({ params }: Props) {
  const { id } = await params;
  const claim = await getExpenseClaim(id);
  if (!claim) notFound();

  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const statusColour = STATUS_COLOURS[claim.status] ?? "#6b7280";
  const formatMoney = (amount: unknown) =>
    Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

  const totalAmount = Number(claim.totalAmount);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/expense-claims" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Expense Claims
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{claim.claimId}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-[var(--dpf-text)] font-mono">
              {claim.claimId}
            </h1>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={{ color: statusColour, backgroundColor: `${statusColour}20` }}
            >
              {claim.status}
            </span>
          </div>
          <p className="text-sm text-[var(--dpf-muted)]">
            {claim.employee.displayName} · {claim.title}
          </p>
        </div>
        <ExpenseClaimActions
          claimId={claim.id}
          status={claim.status}
          approvalToken={claim.approvalToken ?? null}
        />
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Submitted",
            value: claim.submittedAt
              ? new Date(claim.submittedAt).toLocaleDateString("en-GB")
              : "—",
          },
          {
            label: "Approved By",
            value: claim.approvedBy?.email ?? "—",
          },
          {
            label: "Approved Date",
            value: claim.approvedAt
              ? new Date(claim.approvedAt).toLocaleDateString("en-GB")
              : "—",
          },
          {
            label: "Total Amount",
            value: `${sym}${formatMoney(totalAmount)}`,
          },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          >
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">
              {label}
            </p>
            <p className="text-sm text-[var(--dpf-text)]">{value}</p>
          </div>
        ))}
      </div>

      {/* Expense items table */}
      <section className="mb-8">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Expense Items
        </h2>
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Date
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Category
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Description
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Amount
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Receipt
                </th>
              </tr>
            </thead>
            <tbody>
              {claim.items.map((item) => {
                const catColour = CATEGORY_COLOURS[item.category] ?? "#6b7280";
                return (
                  <tr
                    key={item.id}
                    className="border-b border-[var(--dpf-border)] last:border-0"
                  >
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {new Date(item.date).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ color: catColour, backgroundColor: `${catColour}20` }}
                      >
                        {item.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-text)]">
                      {item.description}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                      {sym}{formatMoney(item.amount)}
                    </td>
                    <td className="px-4 py-2.5">
                      {item.receiptUrl ? (
                        <a
                          href={item.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--dpf-accent)] hover:underline text-[9px]"
                        >
                          View receipt
                        </a>
                      ) : (
                        <span className="text-[var(--dpf-muted)] text-[9px]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--dpf-border)]">
                <td
                  colSpan={3}
                  className="px-4 py-2.5 text-right text-[var(--dpf-text)] text-[10px] uppercase tracking-widest font-semibold"
                >
                  Total
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--dpf-text)] font-bold">
                  {sym}{formatMoney(totalAmount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Notes */}
      {claim.notes && (
        <section>
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Notes
          </h2>
          <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <p className="text-sm text-[var(--dpf-text)] whitespace-pre-wrap">{claim.notes}</p>
          </div>
        </section>
      )}

      {/* Rejection reason */}
      {claim.status === "rejected" && claim.rejectedReason && (
        <section className="mt-6">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Rejection Reason
          </h2>
          <div
            className="p-4 rounded-lg border"
            style={{ borderColor: "#ef444440", backgroundColor: "#ef444410" }}
          >
            <p className="text-sm text-[var(--dpf-text)]">{claim.rejectedReason}</p>
          </div>
        </section>
      )}
    </div>
  );
}
