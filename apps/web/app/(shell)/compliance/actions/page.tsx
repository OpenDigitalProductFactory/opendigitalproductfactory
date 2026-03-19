import { listCorrectiveActions } from "@/lib/actions/compliance";
import { CORRECTIVE_ACTION_STATUSES, CORRECTIVE_ACTION_SOURCE_TYPES } from "@/lib/compliance-types";
import Link from "next/link";
import { CreateCorrectiveActionForm } from "@/components/compliance/CreateCorrectiveActionForm";

type Props = { searchParams: Promise<{ status?: string; sourceType?: string; overdue?: string }> };

export default async function ActionsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    ...(sp.status && { status: sp.status }),
    ...(sp.sourceType && { sourceType: sp.sourceType }),
    ...(sp.overdue === "yes" && { overdue: true as const }),
  };
  const hasFilters = Object.keys(filters).length > 0;
  const actions = await listCorrectiveActions(hasFilters ? filters : undefined);

  const now = new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Corrective Actions</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{actions.length} total</p>
        </div>
        <CreateCorrectiveActionForm />
      </div>

      {/* Filter bar */}
      <form className="flex flex-wrap gap-3 mb-6">
        <select name="status" defaultValue={sp.status ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All statuses</option>
          {CORRECTIVE_ACTION_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <select name="sourceType" defaultValue={sp.sourceType ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All sources</option>
          {CORRECTIVE_ACTION_SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <select name="overdue" defaultValue={sp.overdue ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All due dates</option>
          <option value="yes">Overdue only</option>
        </select>

        <button type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
          Filter
        </button>

        {hasFilters && (
          <Link href="/compliance/actions"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white transition-colors">
            Clear
          </Link>
        )}
      </form>

      {actions.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No corrective actions match the current filters.</p>
      ) : (
        <div className="space-y-2">
          {actions.map((a) => {
            const isOverdue = a.dueDate && a.dueDate < now && !["completed", "verified"].includes(a.status);
            return (
              <Link key={a.id} href={`/compliance/actions/${a.id}`} className={`block p-3 rounded-lg border ${isOverdue ? "border-red-500/50" : "border-[var(--dpf-border)]"} hover:border-[var(--dpf-accent)] transition-colors`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{a.title}</span>
                      {isOverdue && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-semibold">OVERDUE</span>
                      )}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{a.sourceType}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        a.status === "verified" ? "bg-green-900/30 text-green-400" :
                        a.status === "completed" ? "bg-blue-900/30 text-blue-400" :
                        a.status === "open" ? "bg-yellow-900/30 text-yellow-400" :
                        "bg-gray-900/30 text-gray-400"
                      }`}>
                        {a.status}
                      </span>
                      {a.incident && <span className="text-[9px] text-[var(--dpf-muted)]">&larr; {a.incident.title}</span>}
                      {a.auditFinding && <span className="text-[9px] text-[var(--dpf-muted)]">&larr; {a.auditFinding.title}</span>}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--dpf-muted)]">
                    {a.dueDate && <p className={isOverdue ? "text-red-400" : ""}>Due: {new Date(a.dueDate).toLocaleDateString()}</p>}
                    {a.owner && <p>{a.owner.displayName}</p>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
