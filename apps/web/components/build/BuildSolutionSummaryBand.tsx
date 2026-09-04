// apps/web/components/build/BuildSolutionSummaryBand.tsx
//
// Band 1 of the Build Studio overseer "Solution & Oversight" layer:
// "What we're building" — a plain-language paragraph of the solution's intent
// for a non-technical overseer, drawn from the build's designDoc (problem +
// approach) with a fallback to the captured intent before a design exists.
// Presentational only; no prompt-send, no mutation; all --dpf-* tokens.
// The live preview ("see it") is the shared footer link. Spec:
// docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md (Band 1).
//
// NOTE: this band is additive (renders above the existing surfaces). The full
// IA reframe — making this plain layer the DEFAULT and demoting the engineer
// ProcessGraph behind an "Engineer view" disclosure — is BI-90670010's separate
// restructure step and is intentionally NOT part of this additive component.

import { StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import { summaryCopyFor } from "@/lib/build/owner-change-view";
import type { AutonomousBuildCustodyView } from "@/lib/build/autonomous-build-custody";

type Props = {
  /** designDoc.problemStatement, if a design has been produced. */
  problemStatement?: string | null;
  /** designDoc.proposedApproach, if present. */
  proposedApproach?: string | null;
  /** Captured intent (originating backlog item description) — shown before a
   *  design doc exists so the band is never empty during early ideation. */
  fallbackIntent?: string | null;
  /** Plain-language autonomous custody state; provenance stays collapsed. */
  custody?: AutonomousBuildCustodyView | null;
  /** The build title, so this band can stay silent when its only content would
   *  repeat the heading the operator already read one card above. */
  buildTitle?: string | null;
};

const OPERATOR_SUMMARY_LIMIT = 260;
const OPERATOR_APPROACH_LIMIT = 170;

function isTechnicalPlanCopy(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > OPERATOR_APPROACH_LIMIT) return true;
  return /\b(Data Model|ModelProvider|BuildEngine|API Route|server-side|tool-use|CLI-backed|opencode|schema|migration)\b/i.test(normalized);
}

export function BuildSolutionSummaryBand({
  problemStatement,
  proposedApproach,
  fallbackIntent,
  custody,
  buildTitle,
}: Props) {
  const problem = problemStatement?.trim() || null;
  const approach = proposedApproach?.trim() || null;
  const fallback = fallbackIntent?.trim() || null;
  const primaryCopy = problem ?? fallback;
  const operatorProblem = summaryCopyFor(primaryCopy, buildTitle, OPERATOR_SUMMARY_LIMIT);
  const showApproach = approach != null && !isTechnicalPlanCopy(approach);
  const operatorApproach = showApproach ? summaryCopyFor(approach, null, OPERATOR_APPROACH_LIMIT) : null;

  // Nothing to say → render nothing. This is checked against what will ACTUALLY
  // be rendered, not against the raw inputs: once the de-duplication above
  // suppresses copy that merely repeats the heading, a band with raw inputs but
  // no surviving content would otherwise draw an empty titled card — a heading
  // with nothing under it, which costs attention and returns none.
  const hasRenderableContent =
    operatorProblem != null || operatorApproach != null || approach != null || custody != null;
  if (!hasRenderableContent) return null;
  const custodyIntent: Intent =
    custody?.state === "complete"
      ? "success"
      : custody?.state === "needs-decision"
        ? "danger"
        : custody?.state === "recovering"
          ? "warning"
          : custody?.state === "shadow"
            ? "neutral"
            : "info";

  return (
    <section
      data-testid="build-solution-summary-band"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
    >
      <div className="flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="text-[var(--dpf-muted)]"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12" />
        </svg>
        <h3 className="m-0 text-sm font-semibold text-[var(--dpf-text)]">
          What we&rsquo;re building
        </h3>
      </div>

      {operatorProblem ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--dpf-text)]">{operatorProblem}</p>
      ) : null}

      {operatorApproach ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
          {operatorApproach}
        </p>
      ) : approach ? (
        <p className="mt-2 text-[11px] font-medium text-[var(--dpf-muted)]">
          AI Coworker has the technical plan.
        </p>
      ) : null}

      {custody ? (
        <div
          className="mt-3 border-t border-[var(--dpf-border)] pt-3"
          data-testid="autonomous-build-custody"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              intent={custodyIntent}
              label={custody.title}
              variant="soft"
              uppercase={false}
            />
            {custody.attentionRequired ? (
              <span className="text-xs font-medium text-[var(--dpf-text)]">
                Attention required
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--dpf-muted)]">
            {custody.detail}
          </p>
          <details className="mt-2 text-xs text-[var(--dpf-muted)]">
            <summary className="cursor-pointer font-medium text-[var(--dpf-text)]">
              Engineer details
            </summary>
            <dl className="mt-2 grid gap-1 border-l border-[var(--dpf-border)] pl-3">
              <div>
                <dt className="inline font-medium">Checkpoint: </dt>
                <dd className="inline">{custody.engineer.checkpoint}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Policy: </dt>
                <dd className="inline">
                  {custody.engineer.method ?? "governed default"}
                  {custody.engineer.patternVersion != null
                    ? ` v${custody.engineer.patternVersion}`
                    : ""}
                </dd>
              </div>
              {custody.engineer.provider ? (
                <div>
                  <dt className="inline font-medium">Execution: </dt>
                  <dd className="inline">
                    {custody.engineer.provider}
                    {custody.engineer.model ? ` / ${custody.engineer.model}` : ""}
                  </dd>
                </div>
              ) : null}
              {custody.engineer.blockers.length > 0 ? (
                <div>
                  <dt className="inline font-medium">Evidence blockers: </dt>
                  <dd className="inline">{custody.engineer.blockers.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          </details>
        </div>
      ) : null}
    </section>
  );
}
