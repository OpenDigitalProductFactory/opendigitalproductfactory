import "server-only";

import { prisma } from "@dpf/db";
import { STANDING_ROOM_PORTFOLIO_BY_SHAPE_KEY } from "@dpf/storefront-templates";

import { TERMINAL_CAPSULE_STATUSES } from "@/lib/build/unified-wip-query";
import type { WorkPortfolioRoleKey } from "@/lib/navigation/area-portfolio";
import { getAreaSetupEntries, getShellNavEntries } from "@/lib/navigation/portal-navigation-model";
import type { PortalShellSectionKey } from "@/lib/navigation/portal-shell-sections";
import { getWorkShape } from "@/lib/work-management/work-shapes";

import { projectAreaTeam, type AreaTeamMember } from "./area-team";

/** The routes an area owns: its rail entries and the settings in its Setup view. */
export function areaRoutes(area: PortalShellSectionKey): Array<{ path: string; label: string }> {
  return [
    ...getShellNavEntries().filter((entry) => entry.sectionKey === area),
    ...getAreaSetupEntries(area),
  ].map((entry) => ({ path: entry.path, label: entry.label }));
}

function routeLabelFor(resourceRef: string, routes: Array<{ path: string; label: string }>): string | null {
  const match = routes
    .filter((route) => resourceRef === route.path || resourceRef.startsWith(`${route.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match ? match.label : null;
}

/** The work shapes whose standing rooms serve this portfolio. */
export function areaShapeKeys(portfolioRole: WorkPortfolioRoleKey): string[] {
  return Object.entries(STANDING_ROOM_PORTFOLIO_BY_SHAPE_KEY)
    .filter(([, role]) => role === portfolioRole)
    .map(([shapeKey]) => shapeKey)
    .sort();
}

export async function loadAreaTeam(
  area: PortalShellSectionKey,
  portfolioRole: WorkPortfolioRoleKey,
): Promise<AreaTeamMember[]> {
  const routes = areaRoutes(area);
  const shapeKeys = areaShapeKeys(portfolioRole);

  const [routeBindings, coordinatorBindings, participants] = await Promise.all([
    prisma.authorityBinding.findMany({
      where: { scopeType: "route", status: "active" },
      select: { resourceRef: true, appliedAgent: { select: { slugId: true, agentId: true } } },
    }),
    prisma.authorityBinding.findMany({
      where: { scopeType: "workroom", resourceType: "work-shape", status: "active", resourceRef: { in: shapeKeys } },
      select: { resourceRef: true, subjects: { where: { subjectType: "agent" }, select: { subjectRef: true } } },
    }),
    prisma.workroomParticipant.findMany({
      where: {
        lifecycle: "active",
        workroom: { portfolioRole, status: { notIn: [...TERMINAL_CAPSULE_STATUSES] } },
      },
      select: {
        roles: true,
        principal: {
          select: {
            principalId: true,
            kind: true,
            displayName: true,
            aliases: { where: { aliasType: "agent" }, select: { aliasValue: true } },
          },
        },
      },
      take: 500,
    }),
  ]);

  const routeOwners = routeBindings.flatMap((binding) => {
    const label = routeLabelFor(binding.resourceRef, routes);
    const slug = binding.appliedAgent?.slugId ?? binding.appliedAgent?.agentId;
    return label && slug ? [{ agentSlug: slug, routeLabel: label }] : [];
  });

  const coordinators = coordinatorBindings.flatMap((binding) =>
    binding.subjects.map((subject) => ({
      agentSlug: subject.subjectRef,
      shapeTitle: getWorkShape(binding.resourceRef)?.title ?? binding.resourceRef,
    })),
  );

  const ownerRoles = shapeKeys.flatMap(
    (key) =>
      getWorkShape(key)?.stages
        .map((stage) => stage.accountablePrincipalRef)
        .filter((ref) => ref.startsWith("role:")) ?? [],
  );

  const participantRows = participants.map((row) => ({
    principalId: row.principal.principalId,
    principalKind: row.principal.kind,
    displayName: row.principal.displayName,
    agentSlug: row.principal.aliases[0]?.aliasValue ?? null,
    roles: row.roles,
  }));

  const slugs = [
    ...new Set([
      ...routeOwners.map((owner) => owner.agentSlug),
      ...coordinators.map((coordinator) => coordinator.agentSlug),
      ...participantRows.flatMap((row) => (row.agentSlug ? [row.agentSlug] : [])),
    ]),
  ];
  const agents = await prisma.agent.findMany({
    where: { OR: [{ slugId: { in: slugs } }, { agentId: { in: slugs } }] },
    select: { agentId: true, slugId: true, displayName: true },
  });

  return projectAreaTeam({
    routeOwners,
    coordinators,
    participants: participantRows,
    ownerRoles,
    agents: agents.flatMap((agent) => [
      { slug: agent.agentId, agentId: agent.agentId, displayName: agent.displayName },
      ...(agent.slugId ? [{ slug: agent.slugId, agentId: agent.agentId, displayName: agent.displayName }] : []),
    ]),
  });
}
