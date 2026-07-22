// apps/web/components/owner-first/OwnerFirstSummary.tsx
//
// The owner-first summary band that OPENS each major business-domain page
// (BI-3BCAF95F). It renders, in the owner's own words: what needs action today,
// why it matters, and the single safest next action — before any CRM / HR /
// accountant / platform structure. Server component; the shape it renders comes
// from the pure builders in lib/owner-first/domain-summary.ts.
//
// Density-aware: in Simple mode the band drops the subhead and the per-action
// "why" line, so Simple mode reduces the BODY content of these pages, not only
// the rail (BI-3BCAF95F + BI-655418A7).

import Link from "next/link";

import type { OwnerFirstSummary, OwnerFirstTone } from "@/lib/owner-first/domain-summary";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";

const TONE_BORDER: Record<OwnerFirstTone, string> = {
  urgent: "border-[var(--dpf-danger)]",
  attention: "border-[var(--dpf-warning)]",
  info: "border-[var(--dpf-accent)]",
  calm: "border-[var(--dpf-border)]",
};

export function OwnerFirstSummaryBand({
  summary,
  density = "full",
}: {
  summary: OwnerFirstSummary;
  density?: "full" | "simple";
}) {
  const simple = density === "simple";
  const hasWork = summary.actions.length > 0;

  return (
    <section
      aria-label={`${summary.headline} — what needs you today`}
      className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
    >
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{summary.headline}</h2>
        {!simple && (
          <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">{summary.subhead}</p>
        )}
      </header>

      {hasWork ? (
        <ul className="space-y-3">
          {summary.actions.map((action) => (
            <li
              key={action.id}
              className={`rounded-md border-l-4 ${TONE_BORDER[action.tone]} bg-[var(--dpf-surface-1)] p-3`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{action.title}</p>
                <Link
                  href={action.nextAction.href}
                  {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: action.id }}
                  className="inline-flex min-h-9 items-center rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
                >
                  {action.nextAction.label}
                </Link>
              </div>
              {!simple && (
                <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">{action.why}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--dpf-muted)]">{summary.clearMessage}</p>
      )}
    </section>
  );
}
