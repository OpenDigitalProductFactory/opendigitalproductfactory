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

  const coworkerCount = rows.length;

  return (
    <div className="space-y-5">
      {/* Owner-first lead band. Net-new business shells must lead with a
          data-dpf-lead band, plain high-school-grade copy, and a marked next
          action (UX budget, spec §4.2). The directory itself — the rich,
          searchable RosterView, the same component the platform overview uses —
          is deferred one click away, so arrival is a calm summary rather than a
          wall of coworker cards. This deferral IS the progressive disclosure this
          epic is about. Copy stays short and plain on purpose: the grade is
          measured over the whole default-visible surface. */}
      <header className="space-y-2" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Coworkers</h1>
        <p className="max-w-2xl text-sm leading-5 text-[var(--dpf-muted)]">
          {coworkerCount > 0
            ? `Your AI coworkers live here — ${coworkerCount} in all. Each one is an identity, like a person or a customer. Open one to see what it does. See its cost, skills, and team.`
            : "Your AI coworkers live here. Each one is an identity, like a person or a customer. None are set up yet."}
        </p>
        {coworkerCount > 0 && (
          <a
            href="#all-coworkers"
            data-dpf-primary-action
            data-owner-first-next-action="open-coworker-directory"
            className="inline-flex text-sm font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
          >
            Browse coworkers
          </a>
        )}
      </header>

      {coworkerCount > 0 ? (
        <section id="all-coworkers">
          <OwnerFirstDisclosure
            summary="Browse all coworkers"
            hint="Search, filter, and open any coworker."
          >
            <RosterView
              rows={rows}
              facets={facets}
              initialQuery={initialQuery}
              grantedCapabilities={grantedCapabilities}
            />
          </OwnerFirstDisclosure>
        </section>
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
