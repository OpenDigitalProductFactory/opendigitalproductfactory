import Link from "next/link";
import type {
  FinanceMetricKey,
  FinanceMoneyJob,
  FinanceSurfaceModel,
} from "@/lib/finance/finance-surface";
import { buildFinanceReadinessNotePrompt } from "@/lib/finance/readiness-note";
import { AiFinanceCoworkerAskButton } from "@/components/finance/AiFinanceCoworkerAskButton";

export type MoneyJobMetric = {
  /** Pre-formatted display value, e.g. "£1,250.00" or "3". */
  value: string;
  /** Short supporting line, e.g. "4 invoices outstanding". */
  hint?: string;
  intent?: "neutral" | "success" | "warning" | "danger";
};

const INTENT_TEXT: Record<NonNullable<MoneyJobMetric["intent"]>, string> = {
  neutral: "text-[var(--dpf-text)]",
  success: "text-[var(--dpf-success)]",
  warning: "text-[var(--dpf-warning)]",
  danger: "text-[var(--dpf-error)]",
};

type Props = {
  /** Must be an owner-first surface (mode === "owner-first"). */
  surface: FinanceSurfaceModel;
  /** Formatted live figures keyed by metric, filled in by the server page. */
  metrics: Partial<Record<FinanceMetricKey, MoneyJobMetric>>;
  /**
   * Accounting internals rendered INSIDE the collapsed advanced region so the
   * owner-first screen never leads with them (e.g. the bookkeeper/accountant
   * work lane).
   */
  advancedChildren?: React.ReactNode;
};

/**
 * Owner-first finance overview for food-hospitality. Leads with the money jobs
 * a restaurant owner cares about today and pushes every accounting internal
 * (VAT, dunning, payment runs, GL reports, bank rules, AI spend, the accountant
 * work lane) into clearly-labelled, collapsed advanced sections.
 */
export function OwnerFirstFinanceView({ surface, metrics, advancedChildren }: Props) {
  return (
    <div data-component="owner-first-finance" data-finance-mode={surface.mode}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{surface.headline}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">{surface.subhead}</p>
        </div>
        <Link
          href="/finance/invoices/new"
          className="shrink-0 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          {surface.primaryActionLabel}
        </Link>
      </div>

      {/* Money jobs — the foregrounded "what needs attention today" grid */}
      <section aria-label="Money that needs attention today" className="mb-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {surface.moneyJobs.map((job) => (
            <MoneyJobCard
              key={job.id}
              job={job}
              metric={job.metricKey ? metrics[job.metricKey] : undefined}
            />
          ))}
        </div>
      </section>

      {/* Coworker-drafted readiness note, grounded in the figures above */}
      {surface.subtype && (
        <section aria-label="Readiness note" className="mb-8">
          <div className="flex flex-col gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--dpf-text)]">
                Want this written up?
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
                The Finance Specialist can draft a short readiness note from the figures above —
                what needs attention, why it matters, and the safest next action. It is a draft for
                you to review; nothing is sent and no money moves.
              </p>
            </div>
            <div className="shrink-0">
              <AiFinanceCoworkerAskButton
                prompt={buildFinanceReadinessNotePrompt({
                  subtype: surface.subtype,
                  moneyJobs: surface.moneyJobs,
                  metrics,
                })}
                routeContext="/finance"
                label="Draft readiness note"
              />
            </div>
          </div>
        </section>
      )}

      {/* Subtype invoice entry points */}
      {surface.invoiceEntryPoints.length > 0 && (
        <section aria-label={surface.entryPointSectionLabel} className="mb-8">
          <h2 className="mb-3 text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            {surface.entryPointSectionLabel}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {surface.invoiceEntryPoints.map((entry) => (
              <Link
                key={entry.id}
                href={entry.href}
                className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 transition-colors hover:border-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
              >
                <p className="text-sm font-medium text-[var(--dpf-text)]">{entry.label}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{entry.description}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Deferred accounting internals — collapsed by default */}
      {surface.advancedSections.length > 0 && (
        <section aria-label={surface.advancedSectionLabel} className="mb-6">
          <details className="group rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">
                  {surface.advancedSectionLabel}
                </p>
                <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
                  {surface.advancedSectionDescription}
                </p>
              </div>
              <span className="shrink-0 text-[11px] font-medium text-[var(--dpf-accent)]">
                Show →
              </span>
            </summary>

            <div className="space-y-6 border-t border-[var(--dpf-border)] p-4">
              <div className="grid gap-6 sm:grid-cols-2">
                {surface.advancedSections.map((advanced) => (
                  <div key={advanced.id}>
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                      {advanced.label}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
                      {advanced.description}
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      {advanced.links.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className="text-xs text-[var(--dpf-accent)] hover:underline"
                        >
                          {link.label} →
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {advancedChildren}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

function MoneyJobCard({ job, metric }: { job: FinanceMoneyJob; metric?: MoneyJobMetric }) {
  const intentClass = metric?.intent ? INTENT_TEXT[metric.intent] : "text-[var(--dpf-text)]";

  return (
    <Link
      href={job.href}
      className="flex h-full flex-col rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:border-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--dpf-text)]">{job.label}</p>
        {job.kind === "action" && (
          <span className="shrink-0 rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
            Action
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{job.question}</p>

      <div className="mt-auto pt-3">
        {job.kind === "monitor" && metric ? (
          <>
            <p className={`text-lg font-bold ${intentClass}`}>{metric.value}</p>
            {metric.hint && (
              <p className="mt-0.5 text-[11px] text-[var(--dpf-muted)]">{metric.hint}</p>
            )}
          </>
        ) : (
          <span className="text-[11px] font-medium text-[var(--dpf-accent)]">
            {job.kind === "action" ? "Charge a fee →" : "Open →"}
          </span>
        )}
      </div>
    </Link>
  );
}
