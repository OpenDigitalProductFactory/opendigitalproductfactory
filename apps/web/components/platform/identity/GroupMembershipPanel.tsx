type RoleGroup = {
  roleId: string;
  name: string;
  description: string | null;
  hitlTierMin: number;
  memberCount: number;
  members: Array<{
    displayName: string;
    secondaryLabel: string;
  }>;
};

type BusinessGroup = {
  teamId: string;
  name: string;
  description: string | null;
  memberCount: number;
  primaryMembers: string[];
  coworkerCount: number;
  coworkerNames: string[];
};

export function GroupMembershipPanel({
  roleGroups,
  businessGroups,
}: {
  roleGroups: RoleGroup[];
  businessGroups: BusinessGroup[];
}) {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Groups</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Review business groups, role groups, and the memberships that connect people and AI coworkers to the shared identity plane.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">Role groups</h2>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                Platform roles still act like the highest-level shared groups for route access, HITL posture, and administrative authority.
              </p>
            </div>
            <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              {roleGroups.length} roles
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {roleGroups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-sm text-[var(--dpf-muted)]">
                No role groups have been assigned yet.
              </div>
            ) : null}
            {roleGroups.map((group) => (
              <div
                key={group.roleId}
                className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-mono text-[var(--dpf-muted)]">{group.roleId}</p>
                    <h3 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{group.name}</h3>
                    {group.description ? (
                      <p className="mt-1 text-sm text-[var(--dpf-muted)]">{group.description}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-[var(--dpf-text)]">{group.memberCount} members</p>
                    <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">HITL {group.hitlTierMin}+</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {group.members.map((member) => (
                    <span
                      key={`${group.roleId}-${member.secondaryLabel}`}
                      className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                    >
                      <span className="text-[var(--dpf-muted)]">{member.displayName}</span>
                      {" "}
                      {member.secondaryLabel}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">Business groups</h2>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                Teams are the working groups that connect people, contractors, and AI coworkers to operational contexts like finance, HR, and delivery.
              </p>
            </div>
            <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              {businessGroups.length} teams
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {businessGroups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-sm text-[var(--dpf-muted)]">
                No business groups are linked into identity yet.
              </div>
            ) : null}
            {businessGroups.map((group) => (
              <div
                key={group.teamId}
                className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-mono text-[var(--dpf-muted)]">{group.teamId}</p>
                    <h3 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{group.name}</h3>
                    {group.description ? (
                      <p className="mt-1 text-sm text-[var(--dpf-muted)]">{group.description}</p>
                    ) : null}
                  </div>
                  <p className="text-sm font-medium text-[var(--dpf-text)]">{group.memberCount} members</p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {group.primaryMembers.map((member) => (
                    <span
                      key={`${group.teamId}-${member}`}
                      className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                    >
                      Primary {member}
                    </span>
                  ))}
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px] text-[var(--dpf-text)]">
                    {group.coworkerCount} coworkers
                  </span>
                  {group.coworkerNames.map((coworker) => (
                    <span
                      key={`${group.teamId}-${coworker}`}
                      className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                    >
                      {coworker}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
