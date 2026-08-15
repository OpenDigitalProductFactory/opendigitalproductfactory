import { formatRevenueAmount } from "@/lib/crm/revenue-cockpit";
import type { AccountRetainSnapshot } from "@/lib/crm/retain-data";
import type { HealthBand } from "@/lib/crm/retain-metrics";
import { LocalTime } from "@/components/ui/LocalTime";

const HEALTH_META: Record<HealthBand, { label: string; cls: string }> = {
  healthy: { label: "Healthy", cls: "text-[var(--dpf-success)]" },
  watch: { label: "Watch", cls: "text-[var(--dpf-warning)]" },
  "at-risk": { label: "At risk", cls: "text-[var(--dpf-danger)]" },
};

/**
 * Retain-stage panel (BI-A72D29BE): recurring revenue, churn-risk health, and the next renewal
 * for an account in the recurring back-half. Rendered only for retain-stage accounts.
 */
export function AccountRetainPanel({ snapshot }: { snapshot: AccountRetainSnapshot }) {
  const { currency } = snapshot;
  const health = HEALTH_META[snapshot.health.band];
  const renewal = snapshot.nextRenewal;
  return (
    <section className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Retain</h2>
        <span className={`text-xs font-medium ${health.cls}`}>{health.label}</span>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-[var(--dpf-muted)]">Recurring revenue</dt>
          <dd className="text-[var(--dpf-text)]">
            {snapshot.hasActiveRecurring ? `${formatRevenueAmount(snapshot.mrr, currency)}/mo` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--dpf-muted)]">Annual (ARR)</dt>
          <dd className="text-[var(--dpf-text)]">
            {snapshot.hasActiveRecurring ? formatRevenueAmount(snapshot.arr, currency) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--dpf-muted)]">Next renewal</dt>
          <dd className="text-[var(--dpf-text)]">
            {renewal ? (
              <>
                <LocalTime value={renewal} mode="date" />
                {snapshot.renewalInDays != null && (
                  <span className={snapshot.renewalInDays < 0 ? "text-[var(--dpf-danger)]" : undefined}>
                    {snapshot.renewalInDays < 0
                      ? ` · ${-snapshot.renewalInDays}d overdue`
                      : ` · ${snapshot.renewalInDays}d`}
                  </span>
                )}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      {snapshot.health.reasons.length > 0 && (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">{snapshot.health.reasons.join(" · ")}</p>
      )}
      {snapshot.health.suggestAtRisk && (
        <p className="mt-2 text-xs text-[var(--dpf-danger)]">
          Churn-risk signal — consider marking this account at risk and reaching out.
        </p>
      )}
    </section>
  );
}
