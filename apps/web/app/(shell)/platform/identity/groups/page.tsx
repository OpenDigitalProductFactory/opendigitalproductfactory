import { prisma } from "@dpf/db";

import { GroupMembershipPanel } from "@/components/platform/identity/GroupMembershipPanel";

export default async function PlatformIdentityGroupsPage() {
  const [platformRoles, teams] = await Promise.all([
    prisma.platformRole.findMany({
      include: {
        users: {
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
          orderBy: {
            user: {
              email: "asc",
            },
          },
        },
      },
      orderBy: { roleId: "asc" },
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
  ]);

  return (
    <GroupMembershipPanel
      roleGroups={platformRoles.map((role) => ({
        roleId: role.roleId,
        name: role.name,
        description: role.description,
        hitlTierMin: role.hitlTierMin,
        memberCount: role.users.length,
        members: role.users.slice(0, 5).map((assignment) => ({
          displayName: assignment.user.employeeProfile?.displayName ?? assignment.user.email,
          secondaryLabel: assignment.user.email,
        })),
      }))}
      businessGroups={teams.map((team) => ({
        teamId: team.teamId,
        name: team.name,
        description: team.description,
        memberCount: team.memberships.length,
        primaryMembers: team.memberships
          .filter((membership) => membership.isPrimary)
          .map((membership) => membership.user.employeeProfile?.displayName ?? membership.user.email)
          .slice(0, 3),
        coworkerCount: team.ownerships.length,
        coworkerNames: team.ownerships.map((ownership) => ownership.agent.name).slice(0, 4),
      }))}
    />
  );
}
