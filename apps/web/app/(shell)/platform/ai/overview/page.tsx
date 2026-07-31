// apps/web/app/(shell)/platform/ai/overview/page.tsx - AI Workforce directory (HRIS).
// EP-AI-WORKFORCE-001 (HRIS surface) section 7: the roster overview. A filterable
// directory of every coworker (profession family / value stream / competency /
// jurisdiction / lifecycle / coverage-gap) with fitness-for-duty signals,
// each row linking to that coworker's record.
import Link from "next/link";
import { loadRoster } from "@/lib/coworker-record/roster";
import { loadProfessionCorpusSignals } from "@/lib/coworker-record/corpus-signals";
import { RosterView } from "@/components/platform/coworker-record/RosterView";
import { ProfessionCorpusPanel } from "@/components/platform/coworker-record/ProfessionCorpusPanel";
import { WorkforceSummaryPanel } from "@/components/platform/coworker-record/WorkforceSummaryPanel";
import { computeWorkforceSummary } from "@/lib/coworker-record/workforce-summary";
import { OwnerFirstDisclosure } from "@/components/owner-first/OwnerFirstDisclosure";
import { auth } from "@/lib/auth";
import { getGrantedCapabilities } from "@/lib/permissions";

type PageSearchParams = Record<string, string | string[] | undefined>;

export default async function PlatformAiOverviewPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>;
} = {}) {
  const [{ rows, facets }, corpusSignals, session] = await Promise.all([
    loadRoster(),
    loadProfessionCorpusSignals(),
    auth(),
  ]);
  const initialQuery = toQueryString(
    searchParams ? await searchParams : {},
  );
  const summary = computeWorkforceSummary(rows);
  const grantedCapabilities = session?.user
    ? getGrantedCapabilities({
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      })
    : [];

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">
          AI Workforce
        </h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Find the right coworker for the work you need done.
        </p>
      </header>

      {rows.length > 0 ? (
        <RosterView
          rows={rows}
          facets={facets}
          initialQuery={initialQuery}
          grantedCapabilities={grantedCapabilities}
        />
      ) : (
        <div className="border-l-2 border-[var(--dpf-accent)] py-1 pl-4">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
            No selectable coworkers
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
            Coworkers may be inactive, not in production, or missing matching
            identity records.
          </p>
          <Link
            href="/platform/ai/readiness"
            className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-[var(--dpf-accent)] hover:underline"
          >
            Review workforce readiness
          </Link>
        </div>
      )}

      <div className="mt-8">
        <OwnerFirstDisclosure
          summary="Workforce administration"
          hint="Health, profession coverage, and technical management"
        >
        <div className="space-y-6 pb-4 pt-2">
          <WorkforceSummaryPanel summary={summary} />
          <ProfessionCorpusPanel signals={corpusSignals} />
        </div>
        </OwnerFirstDisclosure>
      </div>
    </div>
  );
}

function toQueryString(searchParams: PageSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }
  return query.toString();
}
