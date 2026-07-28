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

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="text-xl font-semibold text-[var(--dpf-text)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--dpf-muted)]">{label}</div>
    </div>
  );
}

/** Failing first, then never-run, then working, then not-set-up. The operator's
 *  eye should land on what needs them without reading past what does not. */
const STATUS_RANK: Record<JourneyHealthRow["status"], number> = {
  failed: 0,
  "never-run": 1,
  passed: 2,
  "not-applicable": 3,
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Business journeys — whether your customers can actually do the things your
          business depends on.
        </p>
      </div>

      <OpsTabNav />

      <div className="my-6">
        <p className="text-sm text-[var(--dpf-text)]">{journeyHealthHeadline(health)}</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {health.lastRunAt ? (
            <>
              Last checked <LocalTime value={health.lastRunAt} />. Checks run
              Monday, Wednesday and Friday.
            </>
          ) : (
            <>Checks run Monday, Wednesday and Friday.</>
          )}
        </p>
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

      <p className="mt-6 text-xs text-[var(--dpf-muted)]">
        These checks never change your business records. Every check that creates
        something does it inside a rehearsal that is undone immediately, so nothing a
        check writes is ever kept.
      </p>
    </div>
  );
}
