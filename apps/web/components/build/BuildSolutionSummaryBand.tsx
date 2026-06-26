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

type Props = {
  /** designDoc.problemStatement, if a design has been produced. */
  problemStatement?: string | null;
  /** designDoc.proposedApproach, if present. */
  proposedApproach?: string | null;
  /** Captured intent (originating backlog item description) — shown before a
   *  design doc exists so the band is never empty during early ideation. */
  fallbackIntent?: string | null;
};

export function BuildSolutionSummaryBand({
  problemStatement,
  proposedApproach,
  fallbackIntent,
}: Props) {
  const problem = problemStatement?.trim() || null;
  const approach = proposedApproach?.trim() || null;
  const fallback = fallbackIntent?.trim() || null;

  // Nothing to say yet → render nothing (the caller also gates, but stay safe).
  if (!problem && !approach && !fallback) return null;

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

      {problem ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--dpf-text)]">{problem}</p>
      ) : fallback ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--dpf-text)]">{fallback}</p>
      ) : null}

      {approach ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
          {approach}
        </p>
      ) : null}

      <p className="mt-2 text-[11px] text-[var(--dpf-muted)]">
        Use &ldquo;Open live preview&rdquo; at the bottom to see it running.
      </p>
    </section>
  );
}
