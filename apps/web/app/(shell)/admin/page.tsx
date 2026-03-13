// apps/web/app/(shell)/admin/page.tsx
import { prisma } from "@dpf/db";
import { AdminUserAccessPanel } from "@/components/admin/AdminUserAccessPanel";

export default async function AdminPage() {
  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        isActive: true,
        isSuperuser: true,
        createdAt: true,
        groups: {
          select: {
            platformRole: { select: { roleId: true, name: true } },
          },
        },
      },
    }),
    prisma.platformRole.findMany({
      orderBy: { roleId: "asc" },
      select: {
        id: true,
        roleId: true,
        name: true,
      },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {users.length} user{users.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {users.map((u) => {
          const statusColour = u.isActive ? "#4ade80" : "#555566";
          const statusLabel = u.isActive ? "active" : "inactive";

          return (
            <div
              key={u.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#555566" }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-white leading-tight truncate">
                  {u.email}
                </p>
                <div className="flex gap-1 shrink-0">
                  {u.isSuperuser && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ background: "#fbbf2420", color: "#fbbf24" }}
                    >
                      superuser
                    </span>
                  )}
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: `${statusColour}20`, color: statusColour }}
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>
              {u.groups.length === 0 ? (
                <p className="text-[9px] text-[var(--dpf-muted)]">No roles assigned</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {u.groups.map((g) => (
                    <span
                      key={g.platformRole.roleId}
                      className="text-[9px] font-mono text-[var(--dpf-muted)]"
                    >
                      {g.platformRole.roleId}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {users.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No users registered yet.</p>
      )}

      {roles.length > 0 && users.length > 0 && (
        <div className="mt-8">
          <AdminUserAccessPanel
            roles={roles.map((role) => ({ roleId: role.roleId, name: role.name }))}
            users={users.map((user) => ({ id: user.id, email: user.email }))}
          />
        </div>
      )}
    </div>
  );
}
