import {
  WORK_CAPSULE_PORTFOLIO_ROLES,
  type WorkCapsulePortfolioRole,
} from "@/lib/work-capsules";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";

type ArchitectureDb = {
  valueStreamTeam: { findMany(args: unknown): Promise<any[]> };
};

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
