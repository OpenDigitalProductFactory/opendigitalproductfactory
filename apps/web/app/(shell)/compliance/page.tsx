// apps/web/app/(shell)/compliance/page.tsx
import { prisma } from "@dpf/db";

export default async function CompliancePage() {
  const [
    regulationCount,
    activeObligationCount,
    implementedControlCount,
    totalControlCount,
    openIncidentCount,
    overdueActionCount,
    regulations,
    upcomingDeadlines,
    recentActivity,
  ] = await Promise.all([
    prisma.regulation.count({ where: { status: "active" } }),
    prisma.obligation.count({ where: { status: "active" } }),
    prisma.control.count({ where: { implementationStatus: "implemented", status: "active" } }),
    prisma.control.count({ where: { status: "active" } }),
    prisma.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
    prisma.correctiveAction.count({ where: { status: { in: ["open", "in-progress"] }, dueDate: { lt: new Date() } } }),
    prisma.regulation.findMany({
      where: { status: "active" },
      include: { _count: { select: { obligations: true } } },
      orderBy: { shortName: "asc" },
    }),
    prisma.calendarEvent.findMany({
      where: { complianceEntityType: { not: null }, startAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      take: 5,
      select: { id: true, title: true, startAt: true },
    }),
    prisma.complianceAuditLog.findMany({
      orderBy: { performedAt: "desc" },
      take: 10,
      include: { performedBy: { select: { displayName: true } } },
    }),
  ]);

  const coveragePct = totalControlCount > 0
    ? Math.round((implementedControlCount / totalControlCount) * 100)
    : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Compliance</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {regulationCount} regulation{regulationCount !== 1 ? "s" : ""} · {activeObligationCount} obligation{activeObligationCount !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Posture Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Obligations" value={activeObligationCount} color="#ef4444" />
        <MetricCard label="Control Coverage" value={`${coveragePct}%`} color={coveragePct >= 80 ? "#4ade80" : "#fbbf24"} />
        <MetricCard label="Open Incidents" value={openIncidentCount} color={openIncidentCount > 0 ? "#ef4444" : "#4ade80"} />
        <MetricCard label="Overdue Actions" value={overdueActionCount} color={overdueActionCount > 0 ? "#ef4444" : "#4ade80"} />
      </div>

      {/* Upcoming Deadlines */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Upcoming Deadlines</h2>
        {upcomingDeadlines.length === 0
          ? <p className="text-sm text-[var(--dpf-muted)]">No upcoming compliance deadlines.</p>
          : <ul className="space-y-2">
              {upcomingDeadlines.map((e) => (
                <li key={e.id} className="text-sm text-white flex justify-between">
                  <span>{e.title}</span>
                  <span className="text-[var(--dpf-muted)]">{new Date(e.startAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
        }
      </section>

      {/* Recent Activity */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Recent Activity</h2>
        {recentActivity.length === 0
          ? <p className="text-sm text-[var(--dpf-muted)]">No compliance activity yet.</p>
          : <ul className="space-y-2">
              {recentActivity.map((log) => (
                <li key={log.id} className="text-sm text-[var(--dpf-muted)]">
                  <span className="text-white">{log.performedBy?.displayName ?? log.agentId ?? "System"}</span>{" "}
                  {log.action} {log.entityType} — {new Date(log.performedAt).toLocaleString()}
                </li>
              ))}
            </ul>
        }
      </section>

      {/* By Regulation */}
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">By Regulation</h2>
        {regulations.length === 0
          ? <p className="text-sm text-[var(--dpf-muted)]">No regulations registered yet. Add your first regulation to get started.</p>
          : <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {regulations.map((r) => (
                <a key={r.id} href={`/compliance/regulations/${r.id}`}
                  className="block p-4 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-white">{r.shortName}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{r.jurisdiction}</span>
                  </div>
                  <p className="text-xs text-[var(--dpf-muted)]">
                    {r._count.obligations} obligation{r._count.obligations !== 1 ? "s" : ""}
                  </p>
                </a>
              ))}
            </div>
        }
      </section>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="p-4 rounded-lg border border-[var(--dpf-border)]">
      <p className="text-xs text-[var(--dpf-muted)] mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}
