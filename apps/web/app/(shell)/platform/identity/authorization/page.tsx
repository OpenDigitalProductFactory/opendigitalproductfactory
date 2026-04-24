import { prisma } from "@dpf/db";

import { AuthorizationBundlePanel } from "@/components/platform/identity/AuthorizationBundlePanel";
import { getGrantedCapabilities, getShellNavSections, type UserContext } from "@/lib/govern/permissions";

function makeRoleContext(roleId: string): UserContext {
  return {
    platformRole: roleId,
    isSuperuser: false,
  };
}

export default async function PlatformIdentityAuthorizationPage() {
  const [platformRoles, roleAssignments, teams, agents] = await Promise.all([
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
  ]);

  const assignmentsByRoleId = new Map<string, typeof roleAssignments>();
  for (const assignment of roleAssignments) {
    const grouped = assignmentsByRoleId.get(assignment.platformRole.roleId) ?? [];
    grouped.push(assignment);
    assignmentsByRoleId.set(assignment.platformRole.roleId, grouped);
  }

  return (
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
      roleAssignments={platformRoles.map((role) => {
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
      }).filter((role) => role.assignedCount > 0)}
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
  );
}
