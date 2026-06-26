// apps/web/components/build/BuildChangeSummaryBand.tsx
//
// Band 2 of the Build Studio overseer "Solution & Oversight" layer:
// "What's changing" — the auto-generated plain-language change summary
// (BuildChangeNarrative, BI-D93CF6C0). Presentational only; the raw diff stays
// the dive-in. No hardcoded colors. Spec: docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md.

import type { BuildChangeNarrative } from "@/lib/feature-build-types";

export function BuildChangeSummaryBand({
  narrative,
}: {
  narrative: BuildChangeNarrative;
}) {
  return (
    <section
      data-testid="build-change-summary-band"
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
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M6 9v6M13 6h3a2 2 0 0 1 2 2v7M15 4l-2 2 2 2" />
        </svg>
        <h3 className="m-0 text-sm font-semibold text-[var(--dpf-text)]">What&apos;s changing</h3>
      </div>

      <p className="mt-2 text-sm font-medium text-[var(--dpf-text)]">{narrative.headline}</p>

      {narrative.bullets.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
          {narrative.bullets.map((bullet, index) => (
            <li key={`change-bullet-${index}`}>{bullet}</li>
          ))}
        </ul>
      )}

      {narrative.whyItMatters && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
          <span className="font-medium text-[var(--dpf-text)]">Why it matters:</span>{" "}
          {narrative.whyItMatters}
        </p>
      )}

      {narrative.openQuestions && narrative.openQuestions.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--dpf-warning)]">
            One thing we left open
          </div>
          <ul className="mt-0.5 list-disc pl-5 text-xs leading-relaxed text-[var(--dpf-text-secondary)]">
            {narrative.openQuestions.map((question, index) => (
              <li key={`change-open-${index}`}>{question}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
