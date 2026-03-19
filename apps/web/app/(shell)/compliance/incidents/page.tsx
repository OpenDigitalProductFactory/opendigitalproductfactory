import { listIncidents } from "@/lib/actions/compliance";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@/lib/compliance-types";
import Link from "next/link";
import { CreateIncidentForm } from "@/components/compliance/CreateIncidentForm";

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-green-900/30 text-green-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  high: "bg-orange-900/30 text-orange-400",
  critical: "bg-red-900/30 text-red-400",
};

type Props = { searchParams: Promise<{ severity?: string; status?: string; regulatoryNotifiable?: string }> };

export default async function IncidentsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    ...(sp.severity && { severity: sp.severity }),
    ...(sp.status && { status: sp.status }),
    ...(sp.regulatoryNotifiable === "yes" && { regulatoryNotifiable: true as const }),
    ...(sp.regulatoryNotifiable === "no" && { regulatoryNotifiable: false as const }),
  };
  const hasFilters = Object.keys(filters).length > 0;
  const incidents = await listIncidents(hasFilters ? filters : undefined);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Incidents</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{incidents.length} total</p>
        </div>
        <CreateIncidentForm />
      </div>

      {/* Filter bar */}
      <form className="flex flex-wrap gap-3 mb-6">
        <select name="severity" defaultValue={sp.severity ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All severities</option>
          {INCIDENT_SEVERITIES.map((s) => (
            <option key={s} value={s}>{s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <select name="status" defaultValue={sp.status ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All statuses</option>
          {INCIDENT_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <select name="regulatoryNotifiable" defaultValue={sp.regulatoryNotifiable ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All notifiable</option>
          <option value="yes">Notifiable</option>
          <option value="no">Not Notifiable</option>
        </select>

        <button type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
          Filter
        </button>

        {hasFilters && (
          <Link href="/compliance/incidents"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white transition-colors">
            Clear
          </Link>
        )}
      </form>

      {incidents.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No incidents match the current filters.</p>
      ) : (
        <div className="space-y-2">
          {incidents.map((inc) => {
            const isOpen = inc.status === "open" || inc.status === "investigating";
            const isNotifiable = inc.regulatoryNotifiable;
            return (
              <Link key={inc.id} href={`/compliance/incidents/${inc.id}`} className={`block p-3 rounded-lg border ${isNotifiable && isOpen ? "border-red-500/50" : "border-[var(--dpf-border)]"} hover:border-[var(--dpf-accent)] transition-colors`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{inc.title}</span>
                      {isNotifiable && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-semibold">
                          NOTIFIABLE
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[inc.severity] ?? "bg-gray-900/30 text-gray-400"}`}>
                        {inc.severity}
                      </span>
                      {inc.category && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{inc.category}</span>}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${isOpen ? "bg-yellow-900/30 text-yellow-400" : "bg-green-900/30 text-green-400"}`}>
                        {inc.status}
                      </span>
                    </div>
                    {isNotifiable && inc.notificationDeadline && isOpen && (
                      <p className="text-[9px] text-red-400 mt-1">
                        Notification deadline: {new Date(inc.notificationDeadline).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-[var(--dpf-muted)]">
                    <p>{new Date(inc.occurredAt).toLocaleDateString()}</p>
                    <p>{inc._count.correctiveActions} action{inc._count.correctiveActions !== 1 ? "s" : ""}</p>
                    {inc.reportedBy && <p>{inc.reportedBy.displayName}</p>}
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
