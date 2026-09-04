import type { BuildStudioCustomerStatus } from "@/lib/build/customer-status-projection";
import { ownerStateBadgeLabel } from "@/lib/build/owner-status-reconciliation";
import type { BuildPhase } from "@/lib/feature-build-types";
import { deriveBuildActivityStory } from "./build-studio-operator-view";
import {
  fallbackNow,
  fallbackNext,
  outcomeDetailFor,
  toOwnerHeading,
} from "@/lib/build/owner-change-view";
import type { BuildAttention } from "@/lib/build/build-attention";

const OWNER_STATE_BADGE = {
  working: "border-[var(--dpf-info)] bg-[var(--dpf-state-info)] text-[var(--dpf-info)]",
  "waiting-capacity": "border-[var(--dpf-warning)] bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)]",
  "waiting-owner": "border-[var(--dpf-warning)] bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)]",
  blocked: "border-[var(--dpf-error)] bg-[var(--dpf-state-error)] text-[var(--dpf-error)]",
  inconclusive: "border-[var(--dpf-warning)] bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)]",
  failed: "border-[var(--dpf-error)] bg-[var(--dpf-state-error)] text-[var(--dpf-error)]",
  complete: "border-[var(--dpf-success)] bg-[var(--dpf-state-success)] text-[var(--dpf-success)]",
  "not-started": "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]",
} as const;

const STEP_TONE = {
  complete: "border-[var(--dpf-success)] bg-[var(--dpf-state-success)] text-[var(--dpf-success)]",
  current: "border-[var(--dpf-accent)] bg-[var(--dpf-state-info)] text-[var(--dpf-accent)]",
  upcoming: "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]",
  attention: "border-[var(--dpf-warning)] bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)]",
} as const;

export function BuildOperatorOverview({
  title,
  outcome,
  phase,
  status,
  attention,
}: {
  title: string;
  outcome: string | null | undefined;
  phase: BuildPhase;
  status?: BuildStudioCustomerStatus | null;
  /** The row's single attention answer. When it says the owner is needed, its
   *  reason IS the next action — so this card can no longer say "no action
   *  needed" about a build the rail is flagging. */
  attention?: BuildAttention | null;
}) {
  const ownerTitle = toOwnerHeading(ownerSafeBuildText(title));
  const ownerOutcome = outcomeDetailFor(
    title,
    outcome ? ownerSafeBuildText(outcome) : outcome,
  );
  const activityPhase = status?.ownerState === "complete"
    ? "complete"
    : status?.ownerState === "failed"
      ? (phase === "failed" ? "failed" : "abandoned")
      : phase;
  const activity = deriveBuildActivityStory(activityPhase);
  const lifecyclePosition = status?.lifecyclePosition ?? fallbackNow(phase);
  // Precedence matters: an attention reason outranks the generic phase
  // fallback, so the chip and this card cannot disagree.
  const nextAction =
    status?.nextAction
    ?? (attention?.needsOwner ? attention.reason : null)
    ?? fallbackNext(phase);
  const badgeState = status?.ownerState ?? attention?.state;
  const ownerBadge = badgeState
    ? {
        label: ownerStateBadgeLabel(badgeState),
        className: OWNER_STATE_BADGE[badgeState],
      }
    : status?.needsYou
      ? {
          label: ownerStateBadgeLabel("waiting-owner"),
          className: OWNER_STATE_BADGE["waiting-owner"],
        }
      : null;

  return (
    <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
      <section data-testid="build-studio-operator-outcome" aria-labelledby="build-outcome-heading">
        <p className="m-0 text-dpf-caption font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
          Outcome
        </p>
        <h2
          id="build-outcome-heading"
          className="m-0 mt-1 max-w-4xl text-balance text-xl font-semibold leading-7 text-[var(--dpf-text)] sm:text-2xl"
        >
          {ownerTitle}
        </h2>
        {ownerOutcome ? (
          <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            {ownerOutcome}
          </p>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section
          data-testid="build-studio-operator-status"
          className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
          aria-labelledby="build-status-heading"
        >
          <div className="flex items-center justify-between gap-3">
            <p
              id="build-status-heading"
              className="m-0 text-dpf-caption font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]"
            >
              Now
            </p>
            {ownerBadge ? (
              <span className={`rounded-full border px-2 py-1 text-dpf-caption font-semibold ${ownerBadge.className}`}>
                {ownerBadge.label}
              </span>
            ) : null}
          </div>
          <p className="m-0 mt-2 text-base font-semibold text-[var(--dpf-text)]">
            {lifecyclePosition}
          </p>
          {status?.worker || status?.elapsedLabel ? (
            <p className="m-0 mt-1 text-xs font-medium leading-5 text-[var(--dpf-text)]">
              {[status?.worker, status?.elapsedLabel].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {status?.evidence ? (
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
              {status.evidence}
            </p>
          ) : null}
        </section>

        <section
          data-testid="build-studio-operator-next-action"
          className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
          aria-labelledby="build-next-heading"
        >
          <p
            id="build-next-heading"
            className="m-0 text-dpf-caption font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]"
          >
            Next
          </p>
          <p className="m-0 mt-2 text-sm font-medium leading-6 text-[var(--dpf-text)]">
            {nextAction}
          </p>
          {status?.expectation ? (
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
              {status.expectation}
            </p>
          ) : null}
        </section>
      </div>

      <section data-testid="build-studio-activity-story" aria-labelledby="build-activity-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p
              id="build-activity-heading"
              className="m-0 text-dpf-caption font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]"
            >
              Activity
            </p>
            <p className="m-0 mt-1 text-xs text-[var(--dpf-muted)]">
              Evidence collected as Build Studio works.
            </p>
          </div>
        </div>
        <ol className="mt-3 grid gap-2 sm:grid-cols-5">
          {activity.map((step) => (
            <li
              key={step.key}
              className={`min-w-0 rounded-lg border p-3 ${STEP_TONE[step.state]}`}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-dpf-caption font-bold"
                  aria-hidden="true"
                >
                  {step.state === "complete" ? "✓" : step.state === "attention" ? "!" : "·"}
                </span>
                <span className="text-xs font-semibold leading-4">{step.label}</span>
              </div>
              {(step.state === "current" || step.state === "attention") ? (
                <p className="m-0 mt-2 text-dpf-caption text-[var(--dpf-muted)]">
                  {step.detail}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Keep governed record keys available in technical details, not owner copy. */
export function ownerSafeBuildText(value: string): string {
  return value
    .replace(/\bBI-[A-Z0-9-]+\b/g, "this backlog item")
    .replace(/\bWC-[A-Z0-9-]+\b/g, "this work record")
    .replace(/\bFB-[A-Z0-9-]+\b/g, "this build");
}

// fallbackStatus() and fallbackNextAction() were deleted here. They duplicated
// fallbackNow()/fallbackNext() in lib/build/owner-change-view.ts and DISAGREED
// with them: the same phase read "Building the solution" here and "Building the
// change" there, and — the defect that mattered — ship phase returned "No action
// needed unless Build Studio asks for a decision" here while the canonical map
// correctly returned "Review the proof before release." A ship-phase build is
// precisely the waiting-owner case, so this surface told the operator no action
// was needed on the one build that was waiting for them.
