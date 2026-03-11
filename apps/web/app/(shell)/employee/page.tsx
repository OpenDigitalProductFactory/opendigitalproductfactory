// apps/web/app/(shell)/employee/page.tsx
import { prisma } from "@dpf/db";

export default async function EmployeePage() {
  const roles = await prisma.platformRole.findMany({
    orderBy: { roleId: "asc" },
    select: {
      id: true,
      roleId: true,
      name: true,
      description: true,
      hitlTierMin: true,
      slaDurationH: true,
      _count: { select: { users: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Employee</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {roles.length} role{roles.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {roles.map((r) => {
          const userCount = r._count.users;
          const sla =
            r.slaDurationH != null && r.slaDurationH > 0
              ? `${r.slaDurationH}h SLA`
              : "No SLA";

          return (
            <div
              key={r.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#7c8cf8" }}
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {r.roleId}
              </p>
              <p className="text-sm font-semibold text-white leading-tight mb-1">
                {r.name}
              </p>
              {r.description != null && (
                <p className="text-[10px] text-[var(--dpf-muted)] line-clamp-2 mb-2">
                  {r.description}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <span className="text-[9px] text-[var(--dpf-muted)]">
                  HITL T{r.hitlTierMin}
                </span>
                <span className="text-[9px] text-[var(--dpf-muted)]">{sla}</span>
                <span className="text-[9px] text-[var(--dpf-muted)]">
                  {userCount === 0 ? "Unassigned" : `${userCount} ${userCount === 1 ? "person" : "people"}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {roles.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No roles registered yet.</p>
      )}
    </div>
  );
}
