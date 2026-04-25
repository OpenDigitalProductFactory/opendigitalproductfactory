import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { BindingBootstrapPanel } from "@/components/platform/authority/BindingBootstrapPanel";
import { BootstrapBindingsButton } from "@/components/platform/authority/BootstrapBindingsButton";
import { BindingDetailDrawer } from "@/components/platform/authority/BindingDetailDrawer";
import { BindingFilters } from "@/components/platform/authority/BindingFilters";
import { BindingList } from "@/components/platform/authority/BindingList";
import { AuthorizationBundlePanel } from "@/components/platform/identity/AuthorizationBundlePanel";
import {
  getAuthorityBinding,
  getAuthorityBindingEvidence,
  getAuthorityBindingFilterOptions,
  listAuthorityBindingRecords,
  listAuthorityBindings,
  parseAuthorityBindingFilters,
} from "@/lib/authority/bindings";
import { getAuthorityBindingBootstrapState } from "@/lib/authority/bootstrap-rollout";
import { getGrantedCapabilities, getShellNavSections, type UserContext } from "@/lib/govern/permissions";
import { can } from "@/lib/permissions";

function makeRoleContext(roleId: string): UserContext {
  return {
    platformRole: roleId,
    isSuperuser: false,
  };
}

type Props = {
  searchParams: Promise<{
    binding?: string;
    status?: string;
    resource?: string;
    coworker?: string;
    subject?: string;
  }>;
};

export default async function PlatformIdentityAuthorizationPage({ searchParams }: Props) {
  const query = await searchParams;
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_platform",
  );
  const activeBindingId = typeof query.binding === "string" ? query.binding : null;
  const currentFilters = {
    status: typeof query.status === "string" ? query.status : undefined,
    resource: typeof query.resource === "string" ? query.resource : undefined,
    coworker: typeof query.coworker === "string" ? query.coworker : undefined,
    subject: typeof query.subject === "string" ? query.subject : undefined,
  };
  const parsedFilters = parseAuthorityBindingFilters(currentFilters);
  const hasActiveFilters = Object.keys(parsedFilters).length > 0;
  const bootstrapState = await getAuthorityBindingBootstrapState({
    canWrite,
    hasActiveFilters,
  });
  const bootstrapAction = canWrite && !bootstrapState.report ? <BootstrapBindingsButton /> : null;

  const [platformRoles, roleAssignments, teams, agents, bindingRecords, bindingList, activeBinding, activeBindingEvidence] = await Promise.all([
    prisma.platformRole.findMany({
      orderBy: { roleId: "asc" },
    }),
    prisma.userGroup.findMany({
      include: {
        platformRole: true,
        user: {
          select: {
            email: true,
            employeeProfile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: [{ platformRole: { roleId: "asc" } }, { user: { email: "asc" } }],
    }),
    prisma.team.findMany({
      include: {
        memberships: {
          include: {
            user: {
              select: {
                email: true,
                employeeProfile: {
                  select: {
                    displayName: true,
                  },
                },
              },
            },
          },
          orderBy: [{ isPrimary: "desc" }, { role: "asc" }],
        },
        ownerships: {
          include: {
            agent: {
              select: {
                agentId: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.agent.findMany({
      select: {
        id: true,
        agentId: true,
        name: true,
        status: true,
        lifecycleStage: true,
        humanSupervisorId: true,
        governanceProfile: {
          select: {
            capabilityClass: {
              select: {
                name: true,
              },
            },
            directivePolicyClass: {
              select: {
                name: true,
              },
            },
          },
        },
        ownerships: {
          include: {
            team: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    listAuthorityBindingRecords(),
    listAuthorityBindings({ pivot: "subject", filters: parsedFilters }),
    activeBindingId ? getAuthorityBinding(activeBindingId) : Promise.resolve(null),
    activeBindingId ? getAuthorityBindingEvidence(activeBindingId) : Promise.resolve([]),
  ]);
  const bindingFilterOptions = getAuthorityBindingFilterOptions(bindingRecords);

  const assignmentsByRoleId = new Map<string, typeof roleAssignments>();
  for (const assignment of roleAssignments) {
    const grouped = assignmentsByRoleId.get(assignment.platformRole.roleId) ?? [];
    grouped.push(assignment);
    assignmentsByRoleId.set(assignment.platformRole.roleId, grouped);
  }

  return (
    <div className="space-y-6">
      {activeBinding ? (
        <section className="space-y-3 rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Editing binding {activeBinding.bindingId}</h2>
            <p className="text-xs text-[var(--dpf-muted)]">
              Human-first edit surface for the shared authority binding record.
            </p>
          </div>
          <BindingDetailDrawer binding={activeBinding} evidence={activeBindingEvidence} />
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Authorization Bindings</h2>
          <p className="text-xs text-[var(--dpf-muted)]">
            Human-first view of route and coworker authority bindings. This is the shared source of truth for who can
            access which governed surface.
          </p>
        </div>
        {bootstrapState.report ? (
          <BindingBootstrapPanel
            autoApplied={bootstrapState.autoApplied}
            totalBindings={bootstrapState.totalBindings}
            report={bootstrapState.report}
          />
        ) : null}
        <BindingFilters
          actionHref="/platform/identity/authorization"
          currentFilters={currentFilters}
          options={bindingFilterOptions}
          resultCount={bindingList.rows.length}
          actions={bootstrapAction}
        />
        <BindingList
          pivot="subject"
          rows={bindingList.rows}
          emptyMessage="No authority bindings have been configured yet."
          detailQueryBase="/platform/identity/authorization"
        />
      </section>

      <AuthorizationBundlePanel
        roleBundles={platformRoles.map((role) => {
          const context = makeRoleContext(role.roleId);
          const routes = getShellNavSections(context).flatMap((section) =>
            section.items.map((item) => ({
              label: item.label,
              href: item.href,
            })),
          );

          return {
            roleId: role.roleId,
            name: role.name,
            description: role.description,
            hitlTierMin: role.hitlTierMin,
            capabilityCount: getGrantedCapabilities(context).length,
            capabilities: getGrantedCapabilities(context).slice(0, 6),
            routes,
          };
        })}
        roleAssignments={platformRoles
          .map((role) => {
            const assignments = assignmentsByRoleId.get(role.roleId) ?? [];
            return {
              roleId: role.roleId,
              roleName: role.name,
              assignedCount: assignments.length,
              people: assignments.slice(0, 4).map((assignment) => ({
                displayName: assignment.user.employeeProfile?.displayName ?? assignment.user.email,
                secondaryLabel: assignment.user.email,
              })),
            };
          })
          .filter((role) => role.assignedCount > 0)}
        teamSummaries={teams.map((team) => ({
          teamId: team.teamId,
          name: team.name,
          memberCount: team.memberships.length,
          leads: team.memberships
            .filter((membership) => membership.isPrimary || membership.role.toLowerCase().includes("lead"))
            .map((membership) => membership.user.employeeProfile?.displayName ?? membership.user.email)
            .slice(0, 3),
          coworkerCount: team.ownerships.length,
        }))}
        coworkerCoverage={agents.map((agent) => ({
          agentId: agent.agentId,
          name: agent.name,
          lifecycleStage: agent.lifecycleStage,
          supervisorRef: agent.humanSupervisorId,
          ownershipTeams: agent.ownerships.map((ownership) => ownership.team.name),
          capabilityClassName: agent.governanceProfile?.capabilityClass.name ?? null,
          directivePolicyClassName: agent.governanceProfile?.directivePolicyClass.name ?? null,
        }))}
      />
    </div>
  );
}
