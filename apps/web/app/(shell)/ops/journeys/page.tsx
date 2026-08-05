// apps/web/app/(shell)/ops/journeys/page.tsx
// BI-E105303D / EP-PROACTIVE-OPS — critical business journey health.
//
// Outcome-first: the operator reads what the business can and cannot do. The
// mechanism (steps, expected vs actual, run ids) lives behind each card's
// technical-details boundary.
//
// `?journey=<id>` is the deep-link target the attention card uses, so an
// interruption lands on the specific journey rather than on this list — the
// BI-C7D25599 2026-07-22 finding that a broad-list landing recreates the
// cognitive load the interruption already spent.

import { prisma } from "@dpf/db";

import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { JourneyHealthCard } from "@/components/ops/JourneyHealthCard";
import { LocalTime } from "@/components/ui/LocalTime";
import {
  journeyHealthHeadline,
  loadJourneyHealth,
  type JourneyHealthRow,
} from "@/lib/business-journeys/journey-health";

// Live posture — never statically cached.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ journey?: string }> };

/** Anchor target for the lead band's next action when nothing is failing. */
const HOW_IT_WORKS_ID = "how-these-checks-work";

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="text-xl font-semibold text-[var(--dpf-text)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--dpf-muted)]">{label}</div>
    </div>
  );
}

/** Failing first, then could-not-check, then never-run, then working, then
 *  not-set-up. The operator's eye should land on what needs them without reading
 *  past what does not.
 *
 *  Could-not-check ranks BELOW failing and above never-run: it is actionable
 *  (a setting is missing) but it is not an outage, and ranking it with the reds
 *  is what made a configuration gap look like a business failure. */
const STATUS_RANK: Record<JourneyHealthRow["status"], number> = {
  failed: 0,
  unverifiable: 1,
  "never-run": 2,
  passed: 3,
  "not-applicable": 4,
};

export default async function BusinessJourneysPage({ searchParams }: Props) {
  const sp = await searchParams;
  const health = await loadJourneyHealth(prisma);

  const rows = [...health.rows].sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;
    // Money-affecting journeys outrank the rest within the same status.
    if (a.revenueBearing !== b.revenueBearing) return a.revenueBearing ? -1 : 1;
    return a.outcome.localeCompare(b.outcome);
  });

  const deepLinked = sp.journey && rows.some((r) => r.journeyId === sp.journey)
    ? sp.journey
    : null;

  // Rows are already ordered failing-first, so the first failure is the one the
  // operator should look at before anything else.
  const firstFailing = rows.find((r) => r.status === "failed") ?? null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Can your customers still do what your business depends on?
        </p>
      </div>

      <OpsTabNav />

      {/* The lead band: the one thing to read first, and the one thing to do
          next. Budgeted separately from the rest of the page. */}
      <div data-dpf-lead className="my-6">
        <p className="text-sm text-[var(--dpf-text)]">{journeyHealthHeadline(health)}</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {health.lastRunAt ? (
            <>
              Last checked <LocalTime value={health.lastRunAt} />. Runs Mon, Wed, Fri.
            </>
          ) : (
            <>Runs Mon, Wed, Fri.</>
          )}
        </p>
        {/* The one thing to do next, in every state — a surface that only marks
            an action when something is broken leaves the owner with no way in
            on the day everything is fine, which is most days. */}
        <a
          data-owner-first-next-action
          href={firstFailing ? `#${firstFailing.journeyId}` : `#${HOW_IT_WORKS_ID}`}
          className="mt-3 inline-block rounded-md border border-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          {firstFailing ? `Start here: ${firstFailing.outcome}` : "See what these checks cover"}
        </a>
      </div>

      <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Not working" value={health.failing} />
        <SummaryTile label="Working" value={health.passing} />
        <SummaryTile label="Not checked yet" value={health.neverRun} />
        <SummaryTile label="Not set up" value={health.notApplicable} />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-sm text-[var(--dpf-muted)]">
          No business journeys are defined for this install yet.
        </p>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => (
            <JourneyHealthCard
              key={row.journeyId}
              row={row}
              highlighted={row.journeyId === deepLinked}
            />
          ))}
        </div>
      )}

      {/* Deferred detail. True and worth stating, but not what the operator came
          for — so it defers rather than adding to the arrival wall of text. */}
      <details id={HOW_IT_WORKS_ID} className="group mt-6">
        <summary className="cursor-pointer list-none text-xs font-medium text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
          <span className="group-open:hidden">How these checks work</span>
          <span className="hidden group-open:inline">Hide how these checks work</span>
        </summary>
        <div className="mt-2 space-y-2 text-xs text-[var(--dpf-muted)]">
          <p>
            Each check says how far it got. Some only open the page. Some go further and
            write a real record to prove it can be saved.
          </p>
          <p>
            Nothing here changes your business records. Anything a check creates is undone
            straight away.
          </p>
        </div>
      </details>
    </div>
  );
}
