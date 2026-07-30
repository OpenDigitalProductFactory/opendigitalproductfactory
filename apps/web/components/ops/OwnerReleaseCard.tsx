// apps/web/components/ops/OwnerReleaseCard.tsx
//
// Owner-readable release status card for /ops/self-upgrade (BI-8D87084D). Renders
// the plain-language summary FIRST, above the technical controls/logs (which move
// behind an Advanced disclosure on the page). Pure/server — no hooks, token-only
// colors, report-kit primitives (no hand-rolled badge/KPI div, AGENTS.md §12).

import { Notice, StatCard, type NoticeVariant } from "@/components/ui/report-kit";
import type { OwnerReleaseSummary, OwnerReleaseTone } from "@/lib/self-upgrade/owner-summary";

const TONE_VARIANT: Record<OwnerReleaseTone, NoticeVariant> = {
  success: "success",
  info: "info",
  warning: "warn",
  danger: "error",
};

const TONE_INTENT = {
  success: "success",
  info: "info",
  warning: "warning",
  danger: "danger",
} as const;

const STATE_MESSAGE_KEY: Partial<Record<OwnerReleaseSummary["state"], string>> = {
  "up-to-date": "current-status",
  "in-progress": "upgrade-progress",
};

function QuestionRow({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-[var(--dpf-border)] py-2 first:border-t-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-xs font-medium text-[var(--dpf-muted)] sm:w-48">{q}</dt>
      <dd className="min-w-0 text-sm text-[var(--dpf-text)]">{a}</dd>
    </div>
  );
}

export function OwnerReleaseCard({
  summary,
  primaryAction,
}: {
  summary: OwnerReleaseSummary;
  /**
   * BI-D77BF495: the live "Upgrade now" trigger, rendered co-located with the
   * status it acts on instead of buried behind the Advanced disclosure below.
   * Optional so this card stays a pure/server component — the caller (a
   * Server Component) passes a Client Component instance through this slot.
   */
  primaryAction?: React.ReactNode;
}) {
  return (
    <section
      aria-label="Release status"
      data-component="owner-release-card"
      data-release-state={summary.state}
      data-dpf-purpose-key="current-state"
      className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <div
        data-dpf-purpose-message-key={STATE_MESSAGE_KEY[summary.state]}
        data-dpf-purpose-correction-signal-key={
          summary.state === "failed" ? "failure-reason-visible" : undefined
        }
      >
        <Notice variant={TONE_VARIANT[summary.tone]} title={summary.headline}>
          <p className="font-medium text-[var(--dpf-text)]">{summary.recommendedAction.label}</p>
          <p className="text-[var(--dpf-muted)]">{summary.recommendedAction.detail}</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Running {summary.currentVersion}
            {summary.availableVersion ? `; ready: ${summary.availableVersion}` : ""}
          </p>
        </Notice>
      </div>

      {summary.riskNotice && (
        <div
          className="rounded-lg border border-[var(--dpf-warning)]/35 bg-[var(--dpf-warning)]/10 px-3 py-2 text-sm text-[var(--dpf-text)]"
          data-dpf-purpose-key="impact-on-work"
          data-dpf-purpose-consequence
          data-dpf-purpose-reversibility
          data-dpf-purpose-authority
          data-dpf-purpose-recovery-context
        >
          <p>
            <span className="font-medium">Before you install:</span>{" "}
            {summary.riskNotice.consequence} {summary.riskNotice.duration}{" "}
            {summary.riskNotice.reversibility}
          </p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {summary.riskNotice.authority} {summary.riskNotice.recovery}
          </p>
        </div>
      )}

      {primaryAction && (
        <div
          data-component="owner-release-primary-action"
          data-dpf-purpose-key="next-action"
          data-dpf-purpose-recovery-signal
        >
          {primaryAction}
        </div>
      )}

      <details
        data-dpf-purpose-disclosure-key="release-details"
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
      >
        <summary
          aria-controls="self-upgrade-release-details"
          data-dpf-purpose-disclosure-trigger
          className="min-h-11 cursor-pointer select-none px-3 py-3 text-sm font-medium text-[var(--dpf-text)] marker:text-[var(--dpf-muted)]"
        >
          Version, impact &amp; recovery
        </summary>
        <div
          id="self-upgrade-release-details"
          data-dpf-purpose-disclosure-region
          className="space-y-4 border-t border-[var(--dpf-border)] p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              label="Running now"
              value={<span className="text-base font-semibold">{summary.currentVersion}</span>}
              intent="neutral"
            />
            <StatCard
              label="Update ready"
              value={
                <span className="text-base font-semibold">
                  {summary.availableVersion ?? "You're current"}
                </span>
              }
              intent={summary.state === "update-available" ? TONE_INTENT.info : "success"}
            />
          </div>

          <dl
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3"
            data-dpf-purpose-key="impact-on-work"
          >
            <QuestionRow q="Can the business keep working?" a={summary.canKeepWorking.detail} />
            <QuestionRow q="What's kept on your system?" a={summary.keptLocally.detail} />
            <div
              data-dpf-purpose-key="recovery-status"
            >
              <QuestionRow q="Can this be undone?" a={summary.rollback.detail} />
            </div>
            <QuestionRow q="If you do nothing" a={summary.ifYouDoNothing} />
          </dl>

          {summary.whatCouldGoWrong.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
                What could go wrong
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--dpf-text)]">
                {summary.whatCouldGoWrong.map((risk, i) => (
                  <li key={i}>{risk}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
