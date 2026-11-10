// The shelter is full. This is the part nobody wants to do.
//
// A capacity decision is a person's to make, and it always will be. What sits
// on that person unfairly is the JUSTIFICATION — assembling the criteria,
// applying them evenly, and being able to say afterwards why this animal and
// not another. That part is carried here: the criteria are fixed in advance,
// applied the same way every time, and shown in full.
//
// So this panel states its reasoning before its shortlist, names everyone it
// refused to consider and why, and never offers a control that acts. There is
// nothing to click. A worker reads it, disagrees with it if they like, and
// decides.

import { Surface } from "@/components/ui/Surface";
import type { TriageReview } from "@/lib/ward/capacity-triage";

export function CapacityReview({ review }: { review: TriageReview }) {
  if (!review.underPressure) return null;

  return (
    <Surface as="section" padding="lg" aria-labelledby="capacity-review-heading">
      <h2 id="capacity-review-heading" className="text-sm font-semibold text-[var(--dpf-text)]">
        Every kennel is full
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--dpf-muted)]">{review.ask}</p>

      {review.candidates.length > 0 ? (
        <ol className="mt-4 space-y-3">
          {review.candidates.map((candidate, index) => (
            <li
              key={candidate.animalRef}
              className="rounded-md border border-[var(--dpf-border)] p-3"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-xs tabular-nums text-[var(--dpf-muted)]">{index + 1}</span>
                <span className="text-sm font-medium text-[var(--dpf-text)]">{candidate.name}</span>
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {candidate.reasons.map((reason) => (
                  <li key={reason} className="text-xs leading-5 text-[var(--dpf-muted)]">
                    {reason}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}

      {review.excluded.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-muted)]">
            {review.excluded.length} not considered, and why
          </summary>
          <ul className="mt-2 space-y-1">
            {review.excluded.map((exclusion) => (
              <li key={exclusion.animalRef} className="text-xs leading-5 text-[var(--dpf-muted)]">
                {exclusion.explanation}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Surface>
  );
}
