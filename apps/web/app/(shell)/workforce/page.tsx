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
import { loadWorkforceActivity } from "@/lib/platform-runtime/workforce-activity";
import { WorkforceNowShell } from "@/components/platform/WorkforceNowShell";
import { getT } from "@/lib/i18n/t.server";

type PageSearchParams = Record<string, string | string[] | undefined>;

export default async function WorkforceDirectoryPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>;
} = {}) {
  const params = searchParams ? await searchParams : {};
  const view = params.view === "activity" ? "activity" : "directory";
  const t = await getT("shell");

  if (view === "activity") {
    const initialData = await loadWorkforceActivity();
    return (
      <div className="space-y-5">
        <CoworkerHeader view={view} t={t} />
        <WorkforceNowShell initialData={initialData} />
      </div>
    );
  }

  const [{ rows, facets }, session] = await Promise.all([loadRoster(), auth()]);
  const initialQuery = toQueryString(params);
  const grantedCapabilities = session?.user
    ? getGrantedCapabilities({
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      })
    : [];

  const coworkerCount = rows.length;

  return (
    <div className="space-y-5">
      <CoworkerHeader view={view} t={t}>
        <p className="max-w-2xl text-sm leading-5 text-[var(--dpf-muted)]">
          {coworkerCount > 0
            ? `You have ${coworkerCount} AI coworkers. Search or open a name.`
            : "You have no AI coworkers yet. Each would be a teammate. None are set up yet."}
        </p>
      </CoworkerHeader>

      {coworkerCount > 0 ? (
        <section aria-label="Coworker directory">
          <RosterView
            rows={rows}
            facets={facets}
            initialQuery={initialQuery}
            grantedCapabilities={grantedCapabilities}
            presentation="directory"
          />
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

function CoworkerHeader({ view, t, children }: { view: "directory" | "activity"; t: Awaited<ReturnType<typeof getT<"shell">>>; children?: React.ReactNode }) {
  return (
    <header className="space-y-3" data-dpf-lead>
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Coworkers</h1>
        {view === "activity" ? (
          <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
            {t("aiCoworkers.activityDescription")}
          </p>
        ) : children}
      </div>
      <div aria-label={t("aiCoworkers.viewsLabel")} className="flex flex-wrap gap-2">
        <ViewLink href="/workforce" current={view === "directory"}>Coworkers</ViewLink>
        <ViewLink href="/workforce?view=activity" current={view === "activity"}>Activity</ViewLink>
        {view === "activity" ? (
          <>
            <a className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]" href="/ops/workrooms">Workrooms</a>
            <a className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]" href="/platform/ai/operations-map">{t("aiCoworkers.operationsMap")}</a>
            <a className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]" href="/platform/ai/overview">{t("aiCoworkers.advancedOperations")}</a>
          </>
        ) : null}
      </div>
    </header>
  );
}

function ViewLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className="rounded-md border px-3 py-2 text-sm font-medium"
      style={{
        borderColor: current ? "var(--dpf-accent)" : "var(--dpf-border)",
        background: current ? "var(--dpf-state-info)" : "transparent",
        color: current ? "var(--dpf-text)" : "var(--dpf-muted)",
      }}
    >
      {children}
    </a>
  );
}

function toQueryString(searchParams: PageSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "view") continue;
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }
  return query.toString();
}
