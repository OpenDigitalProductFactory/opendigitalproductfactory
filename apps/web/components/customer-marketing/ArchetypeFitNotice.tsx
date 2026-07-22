import type { ArchetypeFitAssessment } from "@/lib/marketing/archetype-fit";
import { IMPORTED_TEST_BADGE_LABEL } from "@/lib/marketing/archetype-fit";

/**
 * Small, theme-aware badge + note for an archetype-fit assessment.
 * - block → red "Imported / test data — blocked from publish" badge + reason.
 * - warn  → amber "Check archetype fit" badge + reason.
 * - ok    → renders nothing.
 */
export function ArchetypeFitNotice({
  assessment,
  className = "",
}: {
  assessment: ArchetypeFitAssessment;
  className?: string;
}) {
  if (assessment.severity === "ok") return null;

  const blocked = assessment.blocked;
  const tone = blocked
    ? "border-red-500/50 bg-red-500/10 text-red-500"
    : "border-amber-500/50 bg-amber-500/10 text-amber-600";

  return (
    <div
      data-testid="archetype-fit-notice"
      data-fit-severity={assessment.severity}
      className={`rounded-lg border px-3 py-2 text-xs ${tone} ${className}`.trim()}
    >
      <p className="font-semibold">
        {blocked ? IMPORTED_TEST_BADGE_LABEL : "Check archetype fit before sending"}
      </p>
      <p className="mt-1 leading-snug">{assessment.summary}</p>
    </div>
  );
}

/** Inline pill variant for compact placements (e.g. artifact card headers). */
export function ArchetypeFitBadge({ assessment }: { assessment: ArchetypeFitAssessment }) {
  if (assessment.severity === "ok") return null;
  const blocked = assessment.blocked;
  return (
    <span
      data-testid="archetype-fit-badge"
      data-fit-severity={assessment.severity}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        blocked
          ? "border-red-500/50 bg-red-500/10 text-red-500"
          : "border-amber-500/50 bg-amber-500/10 text-amber-600"
      }`}
    >
      {blocked ? IMPORTED_TEST_BADGE_LABEL : "Check archetype fit"}
    </span>
  );
}
