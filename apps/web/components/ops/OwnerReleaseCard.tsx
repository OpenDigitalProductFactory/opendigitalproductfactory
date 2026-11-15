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
      className="space-y-4 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      {/* The single-sentence answer + the one action, at the top. */}
      <Notice variant={TONE_VARIANT[summary.tone]} title={summary.headline}>
        <p className="font-medium text-[var(--dpf-text)]">{summary.recommendedAction.label}</p>
        <p className="text-[var(--dpf-muted)]">{summary.recommendedAction.detail}</p>
      </Notice>

      {/* Version at-a-glance. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Running now"
          value={<span className="text-base font-semibold">{summary.currentVersion}</span>}
          intent="neutral"
        />
        {/*
          "You're current" is a POSITIVE CLAIM and must be rendered only when
          the summary actually says the install is up to date — never as the
          fallback for a missing label. It used to be exactly that fallback,
          and because availableVersion was gated on
          `state === "update-available"`, a run that was merely running or
          failed collapsed it to null: the card then told the operator they
          were current, in success green, directly above an enabled "Upgrade
          now" button for the update it was denying existed.

          Read updatePending, which is derived from the facts (support, target
          resolution, freshness) rather than from the run state machine, so a
          pending update stays visible while a run is in flight or after one
          fails. The label carries the state; the value carries the identity.
        */}
        <StatCard
          label={summary.availableVersionLabel}
          value={
            <span className="text-base font-semibold">
              {summary.state === "unavailable"
                ? "Not available on this install"
                : summary.updatePending
                  ? summary.availableVersion ?? "Latest build"
                  : "You're current"}
            </span>
          }
          intent={
            summary.state === "unavailable"
              ? TONE_INTENT.warning
              : summary.updatePending
                ? TONE_INTENT.info
                : "success"
          }
        />
      </div>

      {/* The action stays visible; consequence and recovery details move to
          the invocation-time confirmation instead of making the arrival
          surface read like a failure forecast. */}
      {primaryAction && (
        <div data-component="owner-release-primary-action">{primaryAction}</div>
      )}

      <p className="text-sm text-[var(--dpf-muted)]">
        <span className="font-medium text-[var(--dpf-text)]">If you do nothing: </span>
        {summary.ifYouDoNothing}
      </p>
    </section>
  );
}
