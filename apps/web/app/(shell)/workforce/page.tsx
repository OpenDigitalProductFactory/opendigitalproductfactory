// apps/web/app/(shell)/workforce/page.tsx
//
// EP-COWORKER-IDENTITY-360 (DI-CB054DD6F79D) — the AI Coworkers directory, a
// business-domain peer to /employee (People) and /customer (Customers). It is a
// REAL directory (not a redirect into platform admin — that would be a
// cross-domain teleport): it reuses the same roster read-model and RosterView as
// the platform overview, whose rows already open each coworker's identity at
// /workforce/[agentId]. The platform-admin "AI Workforce" overview keeps its
// health/coverage panels; this business surface is the clean identity directory.
import { loadRoster } from "@/lib/coworker-record/roster";
import { RosterView } from "@/components/platform/coworker-record/RosterView";
import { OwnerFirstDisclosure } from "@/components/owner-first/OwnerFirstDisclosure";
import { auth } from "@/lib/auth";
import { getGrantedCapabilities } from "@/lib/permissions";

type PageSearchParams = Record<string, string | string[] | undefined>;

export default async function WorkforceDirectoryPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>;
} = {}) {
  const [{ rows, facets }, session] = await Promise.all([loadRoster(), auth()]);
  const initialQuery = toQueryString(searchParams ? await searchParams : {});
  const grantedCapabilities = session?.user
    ? getGrantedCapabilities({
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      })
    : [];

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Coworkers</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Your AI coworkers as identities — alongside People and Customers. Open one to see what it does, who has
          engaged it, its cost, skills, and teams.
        </p>
      </header>

      {rows.length > 0 ? (
        // Progressive disclosure (EP-COWORKER-IDENTITY-360; the same owner-first
        // pattern People uses to keep its arrival scannable): the directory LEADS
        // with a lean, scannable list of coworker identities — a name that opens
        // the full 360 record where "what it does, who engaged it, cost, skills,
        // teams" live. The rich searchable/filterable RosterView (the same visual
        // component as the platform overview) is one click away behind a collapsed
        // disclosure, so arrival is a directory to scan, not a wall of cards.
        <>
          <ul className="mb-6 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <li key={row.agentId}>
                <a
                  href={`/workforce/${encodeURIComponent(row.agentId)}`}
                  className="block rounded-md px-3 py-2 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
                >
                  {row.displayName}
                </a>
              </li>
            ))}
          </ul>

          <OwnerFirstDisclosure
            summary="Search & filter all coworkers"
            hint="Filter by team, skill, lifecycle, or status; open any coworker's full identity"
          >
            <RosterView
              rows={rows}
              facets={facets}
              initialQuery={initialQuery}
              grantedCapabilities={grantedCapabilities}
            />
          </OwnerFirstDisclosure>
        </>
      ) : (
        <div className="border-l-2 border-[var(--dpf-accent)] py-1 pl-4">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">No coworkers to show</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
            Coworkers may be inactive, not in production, or missing matching identity records.
          </p>
        </div>
      )}
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
