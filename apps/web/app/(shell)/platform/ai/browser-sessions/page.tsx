import { StatCard } from "@/components/ui/report-kit";
import { listBrowserSessions, browserSessionStatusCounts } from "@/lib/browser-drive/ledger";
import { BrowserSessionLedgerTable } from "./BrowserSessionLedgerTable";

// Browser Session Ledger (EP-BROWSER-DRIVE, spec §10.1). Operator surface listing
// driven browser sessions — means, profile kind, target domains, status, actor.
// Read-only; deep audit lives in /platform/ai/authority + /platform/audit/*.

type Props = { searchParams: Promise<{ status?: string }> };

const STATUSES = ["active", "blocked-on-reauth", "failed", "closed"] as const;

export default async function BrowserSessionsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = sp.status && STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status : undefined;

  const [rows, counts] = await Promise.all([
    listBrowserSessions({ status, limit: 200 }),
    browserSessionStatusCounts(),
  ]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Browser Sessions</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Governed browser-driving sessions — every action is grant-gated and recorded.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active" value={counts["active"] ?? 0} intent="info" />
        <StatCard
          label="Needs re-auth"
          value={counts["blocked-on-reauth"] ?? 0}
          intent={(counts["blocked-on-reauth"] ?? 0) > 0 ? "warning" : "neutral"}
          hint="Blocked on operator re-login"
        />
        <StatCard
          label="Failed"
          value={counts["failed"] ?? 0}
          intent={(counts["failed"] ?? 0) > 0 ? "danger" : "neutral"}
        />
        <StatCard label="Total" value={total} intent="neutral" />
      </div>

      <form className="flex flex-wrap gap-3 mb-4">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]"
        >
          <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
            All statuses
          </option>
          {STATUSES.map((s) => (
            <option key={s} value={s} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
              {s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white"
        >
          Filter
        </button>
      </form>

      <BrowserSessionLedgerTable rows={rows} />
    </div>
  );
}
