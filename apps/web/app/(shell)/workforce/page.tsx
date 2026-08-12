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
        <RosterView
          rows={rows}
          facets={facets}
          initialQuery={initialQuery}
          grantedCapabilities={grantedCapabilities}
        />
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
