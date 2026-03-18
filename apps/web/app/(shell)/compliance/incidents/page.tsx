import { prisma } from "@dpf/db";

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-green-900/30 text-green-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  high: "bg-orange-900/30 text-orange-400",
  critical: "bg-red-900/30 text-red-400",
};

export default async function IncidentsPage() {
  const incidents = await prisma.complianceIncident.findMany({
    include: {
      reportedBy: { select: { id: true, displayName: true } },
      _count: { select: { correctiveActions: true } },
    },
    orderBy: { occurredAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Incidents</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{incidents.length} total</p>
        </div>
      </div>

      {incidents.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No incidents recorded.</p>
      ) : (
        <div className="space-y-2">
          {incidents.map((inc) => {
            const isOpen = inc.status === "open" || inc.status === "investigating";
            const isNotifiable = inc.regulatoryNotifiable;
            return (
              <div key={inc.id} className={`p-3 rounded-lg border ${isNotifiable && isOpen ? "border-red-500/50" : "border-[var(--dpf-border)]"} flex items-start justify-between`}>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
