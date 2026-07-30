import { OwnerReleaseCard } from "@/components/ops/OwnerReleaseCard";
import { SelfUpgradePurposeReviewTrigger } from "@/components/ops/SelfUpgradePurposeReviewTrigger";
import { buildOwnerReleaseSummary } from "@/lib/self-upgrade/owner-summary";
import {
  buildSelfUpgradePurposeReviewStatus,
  type SelfUpgradePurposeReviewState,
} from "@/lib/ux-budget/self-upgrade-purpose-review";

export function SelfUpgradePurposeReview({
  state,
  triggerOutcome,
}: {
  state: SelfUpgradePurposeReviewState;
  triggerOutcome: "success" | "error";
}) {
  const status = buildSelfUpgradePurposeReviewStatus(state);
  const summary = buildOwnerReleaseSummary(
    {
      ...status,
      rollbackAvailable: state === "failed-recoverable",
      latestRunImpact: null,
      blockerReason:
        state === "blocked"
          ? "Automatic platform updates are disabled."
          : null,
    },
    { available: true, changes: [] },
  );

  return (
    <div
      data-dpf-purpose-route="/ops/self-upgrade"
      data-dpf-purpose-state={state}
      data-purpose-review-fixture="self-upgrade-v1"
    >
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">
          Self-Upgrade
        </h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Purpose review fixture: no platform operation can be started here.
        </p>
      </div>

      <OwnerReleaseCard
        summary={summary}
        primaryAction={
          <SelfUpgradePurposeReviewTrigger
            state={state}
            triggerOutcome={triggerOutcome}
          />
        }
      />

      <details
        className="mt-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        data-dpf-purpose-disclosure-key="deploy-controls-history"
        open={state === "failed-recoverable"}
      >
        <summary
          aria-controls="purpose-review-deploy-controls"
          data-dpf-purpose-disclosure-trigger
          className="cursor-pointer px-4 py-3 text-sm font-medium"
        >
          Deploy controls &amp; history
        </summary>
        <div
          id="purpose-review-deploy-controls"
          data-dpf-purpose-disclosure-region
          className="border-t border-[var(--dpf-border)] p-4 text-sm"
        >
          {state === "failed-recoverable" ? (
            <div
              id="self-upgrade-latest-run"
              data-dpf-purpose-correction-signal-key="failure-reason-visible"
              className="rounded-lg border border-[var(--dpf-destructive)]/30 p-3"
            >
              The candidate did not pass health checks. Governed recovery
              controls are available.
            </div>
          ) : (
            "No state-specific recovery controls are needed."
          )}
        </div>
      </details>
    </div>
  );
}
