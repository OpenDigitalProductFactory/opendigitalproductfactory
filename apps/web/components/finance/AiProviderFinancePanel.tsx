import { LocalTime } from "@/components/ui/LocalTime";
import type { getAiProviderFinanceDetail } from "@/lib/finance/ai-provider-finance";

type ProviderFinanceDetail = Awaited<ReturnType<typeof getAiProviderFinanceDetail>>;

export function AiProviderFinancePanel({ detail }: { detail: ProviderFinanceDetail }) {
  if (!detail) {
    return (
      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm font-semibold text-[var(--dpf-text)]">Finance bridge</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          This provider has not been handed off to Finance yet.
        </p>
      </div>
    );
  }

  const latestContract = detail.supplierContracts[0] ?? null;
  const latestSnapshot = latestContract?.usageSnapshots[0] ?? null;
  const latestBill = latestContract?.bills[0] ?? null;
  const latestPayment = latestBill?.allocations[0]?.payment ?? null;
  const coveredProviders = providerIdsFromCoverage(latestContract?.coveredProviderIds);
  const billingParts = latestContract
    ? [
        humanizeValue(latestContract.billingCadence),
        latestContract.billingDayOfMonth ? `day ${latestContract.billingDayOfMonth}` : null,
        humanizeValue(latestContract.paymentMethod),
      ].filter(Boolean).join(" · ")
    : "Not scheduled";
  const latestPaymentValue = latestBill
    ? [
        latestBill.status === "paid" || latestPayment?.status === "completed" ? "Paid" : humanizeValue(latestBill.status),
        formatShortDate(latestPayment?.receivedAt ?? latestBill.issueDate),
        formatMoney(Number(latestPayment?.amount ?? latestBill.totalAmount ?? 0), latestPayment?.currency ?? latestBill.currency),
      ].filter(Boolean).join(" · ")
    : "No payment evidence";

  return (
    <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">Finance bridge</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Supplier ownership, contract status, and current utilization context for this provider.
          </p>
        </div>
        {detail.supplier && (
          <a
            href={`/finance/suppliers/${detail.supplier.id}`}
            className="text-xs font-medium text-[var(--dpf-accent)]"
          >
            View supplier →
          </a>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Finance status" value={detail.status.replace(/_/g, " ")} />
        <Metric label="Supplier" value={detail.supplier?.name ?? "Not linked"} />
        <Metric label="Contract" value={latestContract?.status.replace(/_/g, " ") ?? "Not created"} />
        <Metric label="Billing" value={billingParts} />
        <Metric
          label="Open work items"
          value={`${detail.financeWorkItems.filter((item) => item.status !== "done").length}`}
        />
        <Metric
          label="Monthly commitment"
          value={latestContract?.monthlyCommittedAmount
            ? formatMoney(Number(latestContract.monthlyCommittedAmount), latestContract.currency)
            : "Not set"}
        />
        <Metric label="Latest evidence" value={latestPaymentValue} />
        <Metric
          label="Coverage"
          value={coveredProviders.length > 1 ? `${coveredProviders.length} provider rows` : "Single provider"}
        />
      </div>

      {latestBill ? (
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          <a href={`/finance/bills/${latestBill.id}`} className="text-[var(--dpf-accent)]">
            View bill
          </a>
          {latestPayment ? (
            <a href="/finance/payments" className="text-[var(--dpf-accent)]">
              View payments
            </a>
          ) : null}
        </div>
      ) : null}

      {(detail.billingUrl || detail.usageUrl) && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {detail.billingUrl && (
            <a href={detail.billingUrl} target="_blank" rel="noreferrer" className="text-[var(--dpf-accent)]">
              Billing portal
            </a>
          )}
          {detail.usageUrl && (
            <a href={detail.usageUrl} target="_blank" rel="noreferrer" className="text-[var(--dpf-accent)]">
              Usage portal
            </a>
          )}
        </div>
      )}

      {latestSnapshot && (
        <div className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Latest utilization</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            {latestSnapshot.utilizationPct?.toFixed(1) ?? "0.0"}% utilized on{" "}
            <LocalTime value={latestSnapshot.snapshotDate} utc />
          </p>
        </div>
      )}
    </div>
  );
}

function humanizeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

function formatShortDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function providerIdsFromCoverage(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}
