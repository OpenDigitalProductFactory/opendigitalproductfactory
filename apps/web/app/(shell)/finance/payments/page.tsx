// apps/web/app/(shell)/finance/payments/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";

type Props = { searchParams: Promise<{ direction?: string }> };

export default async function PaymentsPage({ searchParams }: Props) {
  const { direction } = await searchParams;

  const payments = await prisma.payment.findMany({
    where: direction
      ? { direction: direction.toLowerCase() }
      : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      allocations: {
        include: {
          invoice: {
            select: { id: true, invoiceRef: true },
          },
        },
      },
    },
  });

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  const directionBadge = (dir: string) => {
    if (dir === "inbound") {
      return (
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full"
          style={{ color: "#4ade80", backgroundColor: "#4ade8020" }}
        >
          inbound
        </span>
      );
    }
    return (
      <span
        className="text-[9px] px-1.5 py-0.5 rounded-full"
        style={{ color: "#f97316", backgroundColor: "#f9731620" }}
      >
        outbound
      </span>
    );
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-white"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-white">Payments</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Payments</h1>
      </div>

      {/* Direction filter pills */}
      <div className="flex gap-2 mb-6">
        <Link
          href="/finance/payments"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !direction
              ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white"
          }`}
        >
          All
        </Link>
        <Link
          href="/finance/payments?direction=inbound"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            direction === "inbound"
              ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white"
          }`}
        >
          Inbound
        </Link>
        <Link
          href="/finance/payments?direction=outbound"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            direction === "outbound"
              ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white"
          }`}
        >
          Outbound
        </Link>
      </div>

      {/* Payments table */}
      {payments.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No payments found.</p>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Ref
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Method
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Direction
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Invoice
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Date
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((pmt) => {
                const linkedInvoice = pmt.allocations[0]?.invoice ?? null;
                return (
                  <tr
                    key={pmt.id}
                    className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                        {pmt.paymentRef}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)] capitalize">
                      {pmt.method}
                    </td>
                    <td className="px-4 py-2.5">
                      {directionBadge(pmt.direction)}
                    </td>
                    <td className="px-4 py-2.5">
                      {linkedInvoice ? (
                        <Link
                          href={`/finance/invoices/${linkedInvoice.id}`}
                          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-white transition-colors"
                        >
                          {linkedInvoice.invoiceRef}
                        </Link>
                      ) : (
                        <span className="text-[var(--dpf-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {pmt.receivedAt
                        ? new Date(pmt.receivedAt).toLocaleDateString("en-GB")
                        : new Date(pmt.createdAt).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-2.5 text-right text-white">
                      £{formatMoney(Number(pmt.amount))}
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
