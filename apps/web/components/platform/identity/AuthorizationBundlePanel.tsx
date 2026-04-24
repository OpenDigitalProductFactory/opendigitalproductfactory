type RoleBundle = {
  roleId: string;
  name: string;
  description: string | null;
  hitlTierMin: number;
  capabilityCount: number;
  capabilities: string[];
  routes: Array<{
    label: string;
    href: string;
  }>;
};

type RoleAssignment = {
  roleId: string;
  roleName: string;
  assignedCount: number;
  people: Array<{
    displayName: string;
    secondaryLabel: string;
  }>;
};

type TeamSummary = {
  teamId: string;
  name: string;
  memberCount: number;
  leads: string[];
  coworkerCount: number;
};

type CoworkerCoverage = {
  agentId: string;
  name: string;
  lifecycleStage: string;
  supervisorRef: string | null;
  ownershipTeams: string[];
  capabilityClassName: string | null;
  directivePolicyClassName: string | null;
};

export function AuthorizationBundlePanel({
  roleBundles,
  roleAssignments,
  teamSummaries,
  coworkerCoverage,
}: {
  roleBundles: RoleBundle[];
  roleAssignments: RoleAssignment[];
  teamSummaries: TeamSummary[];
  coworkerCoverage: CoworkerCoverage[];
}) {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Authorization</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Review role bundles, route coverage, memberships, and AI coworker authority from one shared identity control plane.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">Role bundles</h2>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                Platform roles remain the top-level human authorization bundle, then fan out into route access and capability grants.
              </p>
            </div>
            <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              {roleBundles.length} defined
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {roleBundles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-sm text-[var(--dpf-muted)]">
                No platform roles are configured yet.
              </div>
            ) : null}
            {roleBundles.map((bundle) => (
              <article
                key={bundle.roleId}
                className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-mono text-[var(--dpf-muted)]">{bundle.roleId}</p>
                    <h3 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{bundle.name}</h3>
                  </div>
                  <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-text)]">
                    HITL {bundle.hitlTierMin}+
                  </span>
                </div>
                {bundle.description ? (
                  <p className="mt-2 text-sm text-[var(--dpf-muted)]">{bundle.description}</p>
                ) : null}

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Capabilities</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{bundle.capabilityCount}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Route coverage</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{bundle.routes.length}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Granted routes</p>
                  <div className="flex flex-wrap gap-2">
                    {bundle.routes.map((route) => (
                      <span
                        key={route.href}
                        className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                      >
                        <span className="text-[var(--dpf-muted)]">{route.label}</span>
                        {" "}
                        {route.href}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Representative capabilities</p>
                  <div className="flex flex-wrap gap-2">
                    {bundle.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Current human assignments</h2>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              Users inherit authorization through platform roles, then pick up narrower working context through team memberships.
            </p>
            <div className="mt-4 space-y-3">
              {roleAssignments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-sm text-[var(--dpf-muted)]">
                  No human role assignments have been made yet.
                </div>
              ) : null}
              {roleAssignments.map((assignment) => (
                <div
                  key={assignment.roleId}
                  className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-mono text-[var(--dpf-muted)]">{assignment.roleId}</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{assignment.roleName}</p>
                    </div>
                    <span className="text-sm font-medium text-[var(--dpf-text)]">{assignment.assignedCount} assigned</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {assignment.people.map((person) => (
                      <div
                        key={`${assignment.roleId}-${person.secondaryLabel}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2"
                      >
                        <span className="text-sm text-[var(--dpf-text)]">{person.displayName}</span>
                        <span className="text-[11px] text-[var(--dpf-muted)]">{person.secondaryLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Team memberships</h2>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              Teams help scope work, coworker ownership, and delegated operational context below the platform role layer.
            </p>
            <div className="mt-4 space-y-3">
              {teamSummaries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-sm text-[var(--dpf-muted)]">
                  No team memberships are linked into identity yet.
                </div>
              ) : null}
              {teamSummaries.map((team) => (
                <div
                  key={team.teamId}
                  className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-mono text-[var(--dpf-muted)]">{team.teamId}</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{team.name}</p>
                    </div>
                    <span className="text-sm font-medium text-[var(--dpf-text)]">{team.memberCount} members</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--dpf-text)]">
                    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1">
                      {team.coworkerCount} coworkers
                    </span>
                    {team.leads.map((lead) => (
                      <span
                        key={`${team.teamId}-${lead}`}
                        className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1"
                      >
                        Lead {lead}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>

      <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">AI coworker authority coverage</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Coworkers stay in the same authority plane, but their runtime posture is constrained through governance profiles, supervisors, and ownership teams.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {coworkerCoverage.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-sm text-[var(--dpf-muted)]">
              No AI coworkers are linked into the shared authority plane yet.
            </div>
          ) : null}
          {coworkerCoverage.map((coworker) => (
            <div
              key={coworker.agentId}
              className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-mono text-[var(--dpf-muted)]">{coworker.agentId}</p>
                  <h3 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{coworker.name}</h3>
                </div>
                <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-text)]">
                  {coworker.lifecycleStage}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--dpf-text)]">
                {coworker.supervisorRef ? (
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1">
                    Supervisor {coworker.supervisorRef}
                  </span>
                ) : null}
                {coworker.ownershipTeams.map((team) => (
                  <span
                    key={`${coworker.agentId}-${team}`}
                    className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1"
                  >
                    Team {team}
                  </span>
                ))}
                {coworker.capabilityClassName ? (
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1">
                    {coworker.capabilityClassName}
                  </span>
                ) : null}
                {coworker.directivePolicyClassName ? (
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1">
                    {coworker.directivePolicyClassName}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
