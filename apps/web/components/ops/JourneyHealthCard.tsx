// One critical business journey, as the owner reads it.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md §3
//
// Progressive disclosure, deliberately: the outcome, the status, and the honest
// "not checked" line are always visible; the step-by-step evidence sits behind a
// native <details> boundary so a non-technical operator is never made to read a
// probe log to learn whether customers can book.
//
// <details>/<summary> rather than a JS disclosure: keyboard and screen-reader
// behaviour is correct by construction, and the card still works server-rendered
// before hydration.

import { StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import type { JourneyHealthRow } from "@/lib/business-journeys/journey-health";

const STATUS_PRESENTATION: Record<
  JourneyHealthRow["status"],
  { label: string; intent: Intent }
> = {
  // Never "healthy" or "verified" on its own — the checked/not-checked sentences
  // below carry the qualification, and the badge must not contradict them.
  passed: { label: "Working", intent: "success" },
  failed: { label: "Not working", intent: "danger" },
  "not-applicable": { label: "Not set up", intent: "neutral" },
  "never-run": { label: "Not checked yet", intent: "neutral" },
};

function StepRow({ step }: { step: JourneyHealthRow["steps"][number] }) {
  const intent: Intent =
    step.outcome === "passed" ? "success" : step.outcome === "failed" ? "danger" : "neutral";
  const outcomeLabel =
    step.outcome === "passed" ? "Passed" : step.outcome === "failed" ? "Failed" : "Skipped";
  return (
    <li className="border-t border-[var(--dpf-border)] py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge intent={intent} label={outcomeLabel} size="sm" />
        <span className="text-sm text-[var(--dpf-text)]">{step.label}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">{step.detail}</p>
      {step.expected != null && step.actual != null ? (
        <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-3">
          <dt className="text-[var(--dpf-muted)]">Expected</dt>
          <dd className="text-[var(--dpf-text)]">{step.expected}</dd>
          <dt className="text-[var(--dpf-muted)]">Actual</dt>
          <dd className="text-[var(--dpf-text)]">{step.actual}</dd>
        </dl>
      ) : null}
    </li>
  );
}

export function JourneyHealthCard({
  row,
  highlighted = false,
}: {
  row: JourneyHealthRow;
  highlighted?: boolean;
}) {
  const presentation = STATUS_PRESENTATION[row.status];
  const isFailed = row.status === "failed";

  return (
    <article
      id={row.journeyId}
      data-journey-id={row.journeyId}
      data-status={row.status}
      className={[
        "rounded-lg border bg-[var(--dpf-surface-1)] p-4 sm:p-5",
        highlighted
          ? "border-[var(--dpf-accent)] ring-1 ring-[var(--dpf-accent)]"
          : "border-[var(--dpf-border)]",
      ].join(" ")}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--dpf-text)]">{row.outcome}</h3>
          {row.revenueBearing ? (
            <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">Affects money coming in</p>
          ) : null}
        </div>
        <StatusBadge intent={presentation.intent} label={presentation.label} size="md" />
      </header>

      {isFailed ? (
        <p className="mt-3 text-sm text-[var(--dpf-text)]">{row.businessImpact}</p>
      ) : null}

      {row.status === "not-applicable" && row.notApplicableReason ? (
        <p className="mt-3 text-sm text-[var(--dpf-muted)]">{row.notApplicableReason}</p>
      ) : null}

      {row.checkedSentence || row.notCheckedSentence ? (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">
          {row.checkedSentence ? <span>{row.checkedSentence} </span> : null}
          {/* The anti-false-confidence line. Never hidden behind disclosure —
              a reader who stops at the badge must still see the limit. */}
          {row.notCheckedSentence ? <span>{row.notCheckedSentence}</span> : null}
        </p>
      ) : null}

      {row.steps.length > 0 ? (
        <details className="group mt-4">
          <summary className="cursor-pointer list-none text-xs font-medium text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
            <span className="group-open:hidden">Show technical details</span>
            <span className="hidden group-open:inline">Hide technical details</span>
          </summary>
          <ul className="mt-2">
            {row.steps.map((step) => (
              <StepRow key={step.stepId} step={step} />
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
