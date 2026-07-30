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
      className="space-y-4 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      {/* The single-sentence answer + the one action, at the top. */}
      <div data-dpf-purpose-message-key={STATE_MESSAGE_KEY[summary.state]}>
        <Notice variant={TONE_VARIANT[summary.tone]} title={summary.headline}>
          <p className="font-medium text-[var(--dpf-text)]">{summary.recommendedAction.label}</p>
          <p className="text-[var(--dpf-muted)]">{summary.recommendedAction.detail}</p>
        </Notice>
      </div>

      {/* Version at-a-glance. */}
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        data-dpf-purpose-completion-signal="version-and-health"
      >
        <StatCard
          label="Running now"
          value={<span className="text-base font-semibold">{summary.currentVersion}</span>}
          intent="neutral"
        />
        <StatCard
          label="Update ready"
          value={
            <span className="text-base font-semibold">{summary.availableVersion ?? "You're current"}</span>
          }
          intent={summary.state === "update-available" ? TONE_INTENT.info : "success"}
        />
      </div>

      {/* The questions an owner actually has, answered in plain words. */}
      <dl
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3"
        data-dpf-purpose-key="impact-on-work"
      >
        <QuestionRow q="Can the business keep working?" a={summary.canKeepWorking.detail} />
        <QuestionRow q="What's kept on your system?" a={summary.keptLocally.detail} />
        <div
          data-dpf-purpose-key="recovery-status"
          data-dpf-purpose-correction-signal="available"
          data-dpf-purpose-recovery-signal
        >
          <QuestionRow
            q="Can this be undone?"
            a={
              <>
                {summary.rollback.detail}{" "}
                <a
                  href="/docs/operations/self-upgrade"
                  data-dpf-purpose-action-key="open-recovery-guidance"
                  className="inline-flex min-h-11 items-center text-[var(--dpf-accent)] underline-offset-2 hover:underline"
                >
                  Recovery guidance
                </a>
              </>
            }
          />
        </div>
        <QuestionRow q="If you do nothing" a={summary.ifYouDoNothing} />
      </dl>

      {/* Honest, short risk list. */}
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

      {/* Consequence / reversibility / duration / recovery BEFORE the install action. */}
      {summary.riskNotice && (
        <div
          data-dpf-purpose-consequence
          data-dpf-purpose-reversibility
          data-dpf-purpose-authority
          data-dpf-purpose-recovery-context
        >
          <Notice variant="warn" title="Before you install">
            <ul className="space-y-0.5">
              <li>
                <span className="font-medium">What happens:</span> {summary.riskNotice.consequence}
              </li>
              <li>
                <span className="font-medium">Can it be undone:</span> {summary.riskNotice.reversibility}
              </li>
              <li>
                <span className="font-medium">How long:</span> {summary.riskNotice.duration}
              </li>
              <li>
                <span className="font-medium">Who can do it:</span> {summary.riskNotice.authority}
              </li>
              <li>
                <span className="font-medium">If it fails:</span> {summary.riskNotice.recovery}
              </li>
            </ul>
          </Notice>
        </div>
      )}

      {/* BI-D77BF495: the live trigger, directly below the risk notice it
          answers to — visible on arrival, not buried behind the Advanced
          disclosure (run history / ledgers / logs stay there). */}
      {primaryAction && (
        <div
          data-component="owner-release-primary-action"
          data-dpf-purpose-key="next-action"
        >
          {primaryAction}
        </div>
      )}

    </section>
  );
}
