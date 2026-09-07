import {
  WORK_CAPSULE_PORTFOLIO_ROLES,
  type WorkCapsulePortfolioRole,
} from "@/lib/work-capsules";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";
import { TERMINAL_CAPSULE_STATUSES } from "@/lib/work-capsules/work-capsule-branch-identity";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import type { PrismaClient } from "@dpf/db";

type ArchitectureDb = {
  valueStreamTeam: { findMany(args: unknown): Promise<any[]> };
};

/** A bounded observation of actual rooms; assignment never implies accountability. */
export async function loadWorkroomCoordination(
  db: { workroom: Pick<PrismaClient["workroom"], "findMany"> },
  now = new Date(),
  filter: { teamId?: string | null } = {},
) {
  const rows = await db.workroom.findMany({
    where: { archivedAt: null, status: { notIn: TERMINAL_CAPSULE_STATUSES },
      ...(filter.teamId === undefined ? {} : filter.teamId === null
        ? { OR: [{ workItem: { is: null } }, { workItem: { is: { teamId: null } } }] }
        : { workItem: { is: { teamId: filter.teamId } } }),
    },
    orderBy: { capsuleId: "asc" }, take: 201,
    select: { capsuleId: true, title: true, status: true,
      workItem: { select: { teamId: true, parentItemId: true, assignedToUserId: true, assignedToAgentId: true } },
    },
  });
  return {
    readAt: now.toISOString(), truncated: rows.length > 200,
    rooms: rows.slice(0, 200).map((row) => {
      const teamId = row.workItem?.teamId ?? null;
      const caseKey = encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: row.capsuleId });
      return {
        roomId: row.capsuleId, title: row.title, status: row.status, teamId,
        parentItemId: row.workItem?.parentItemId ?? null,
        assignedActorRef: row.workItem?.assignedToUserId ?? row.workItem?.assignedToAgentId ?? null,
        href: `/workspace/cases/${caseKey}?operation=${encodeURIComponent(teamId ?? "unmapped")}`,
      };
    }),
  };
}

export type WorkroomDefinition = {
  id: string;
  name: string;
  valueStream: string;
  shape: string;
  coordinationPattern: unknown;
  isActive: boolean;
  participants: Array<{ roleName: string; workerType: string; modelTier: string | null }>;
  triggers: Array<{ triggerPoint: string; requiredRole: string; escalationTimeoutMinutes: number }>;
  queues: Array<{ queueId: string; name: string; queueType: string; isActive: boolean }>;
  instanceCount: number;
  eaProcessId: string | null;
  eaViewId: string | null;
};

export type WorkroomPortfolioBand = {
  role: WorkCapsulePortfolioRole;
  label: string;
  definitions: WorkroomDefinition[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function portfolioRoleOf(team: any): WorkCapsulePortfolioRole {
  const explicit = asRecord(team.coordinationPattern).portfolioRole;
  if (typeof explicit === "string" && WORK_CAPSULE_PORTFOLIO_ROLES.includes(explicit as WorkCapsulePortfolioRole)) {
    return explicit as WorkCapsulePortfolioRole;
  }
  const normalized = String(team.portfolio?.slug ?? team.portfolio?.name ?? "").replaceAll(/[^a-z]/gi, "").toLocaleLowerCase("en-US");
  const aliases: Record<string, WorkCapsulePortfolioRole> = {
    foundational: "foundational",
    foundation: "foundational",
    manufactureanddeliver: "manufactureAndDeliver",
    manufacturinganddelivery: "manufactureAndDeliver",
    operations: "manufactureAndDeliver",
    foremployees: "forEmployees",
    workforce: "forEmployees",
    productsandservicessold: "productsAndServicesSold",
    goodsandservicesforsale: "productsAndServicesSold",
  };
  return aliases[normalized] ?? "foundational";
}

export async function loadWorkroomArchitecture(db: ArchitectureDb): Promise<WorkroomPortfolioBand[]> {
  const teams = await db.valueStreamTeam.findMany({
    where: { isActive: true },
    orderBy: [{ portfolioId: "asc" }, { name: "asc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      valueStream: true,
      teamPattern: true,
      coordinationPattern: true,
      eaProcessId: true,
      eaViewId: true,
      portfolioId: true,
      isActive: true,
      portfolio: { select: { slug: true, name: true } },
      roles: {
        orderBy: [{ priority: "asc" }, { roleName: "asc" }],
        select: { roleName: true, workerType: true, modelTier: true },
      },
      hitlGates: {
        orderBy: [{ triggerPoint: "asc" }, { requiredRole: "asc" }],
        select: { triggerPoint: true, requiredRole: true, escalationTimeoutMinutes: true },
      },
      queues: {
        orderBy: { name: "asc" },
        select: { queueId: true, name: true, queueType: true, isActive: true },
      },
      workItems: { select: { _count: { select: { capsules: true } } } },
    },
  });

  const bands = WORK_CAPSULE_PORTFOLIO_ROLES.map((role) => ({
    role,
    label: portfolioRoleLabel(role),
    definitions: [] as WorkroomDefinition[],
  }));
  const byRole = new Map(bands.map((band) => [band.role, band]));
  for (const team of teams) {
    byRole.get(portfolioRoleOf(team))?.definitions.push({
      id: team.id,
      name: team.name,
      valueStream: team.valueStream,
      shape: team.teamPattern,
      coordinationPattern: team.coordinationPattern,
      isActive: team.isActive,
      participants: team.roles,
      triggers: team.hitlGates,
      queues: team.queues,
      instanceCount: team.workItems.reduce((total: number, item: any) => total + (item._count?.capsules ?? 0), 0),
      eaProcessId: team.eaProcessId,
      eaViewId: team.eaViewId,
    });
  }
  return bands;
}
