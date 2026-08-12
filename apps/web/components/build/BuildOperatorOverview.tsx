import type { BuildStudioCustomerStatus } from "@/lib/build/customer-status-projection";
import { ownerStateBadgeLabel } from "@/lib/build/owner-status-reconciliation";
import type { BuildPhase } from "@/lib/feature-build-types";
import { deriveBuildActivityStory } from "./build-studio-operator-view";

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
}: {
  title: string;
  outcome: string | null | undefined;
  phase: BuildPhase;
  status?: BuildStudioCustomerStatus | null;
}) {
  const activity = deriveBuildActivityStory(phase);
  const lifecyclePosition = status?.lifecyclePosition ?? fallbackStatus(phase);
  const nextAction = status?.nextAction ?? fallbackNextAction(phase);
  const ownerBadge = status?.ownerState
    ? {
        label: ownerStateBadgeLabel(status.ownerState),
        className: OWNER_STATE_BADGE[status.ownerState],
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
          {title}
        </h2>
        {outcome ? (
          <p className="m-0 mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            {outcome}
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

function fallbackStatus(phase: BuildPhase): string {
  const labels: Record<BuildPhase, string> = {
    ideate: "Understanding the outcome",
    plan: "Shaping the approach",
    build: "Building the solution",
    review: "Checking the work",
    ship: "Preparing for release",
    complete: "Ready to use",
    failed: "Needs recovery",
    abandoned: "Work stopped",
  };
  return labels[phase];
}

function fallbackNextAction(phase: BuildPhase): string {
  if (phase === "failed") return "Resolve the blocker, then resume the governed build.";
  if (phase === "abandoned") return "Resume this outcome only if it is still valuable.";
  if (phase === "complete") return "No action needed. The evidence remains available in technical details.";
  return "No action needed unless Build Studio asks for a decision.";
}
