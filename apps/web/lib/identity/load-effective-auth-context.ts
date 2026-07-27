import { prisma } from "@dpf/db";

import type { DpfSession } from "@/lib/govern/auth";

import {
  buildEffectiveAuthContext,
  type AuthSource,
  type EffectiveAuthContext,
} from "./effective-auth-context";

type PrincipalRow = {
  principalId: string;
  kind: string;
  status: string;
  sensitivityClearance: string[];
  aliases: Array<{ aliasType: string; aliasValue: string; issuer: string }>;
};

type EmployeeRow = {
  id: string;
  userId: string | null;
  managerEmployeeId: string | null;
};

type EffectiveAuthContextDb = {
  principalAlias: {
    findFirst(args: unknown): Promise<{ principal: PrincipalRow } | null>;
  };
  employeeProfile: {
    findMany(args: unknown): Promise<EmployeeRow[]>;
  };
  teamMembership: {
    findMany(args: unknown): Promise<Array<{ teamId: string }>>;
  };
  delegationGrant: {
    findMany(
      args: unknown,
    ): Promise<Array<{ grantId: string; maxUses: number | null; useCount: number }>>;
  };
};

export type LoadEffectiveAuthContextInput = {
  user: DpfSession["user"];
  grantedCapabilities: string[];
  authentication: {
    source: AuthSource;
    methods?: string[];
    contextClassReference?: string | null;
  };
  actingAgentId?: string | null;
  now?: Date;
};

export function resolveManagerScope(
  employeeRows: readonly EmployeeRow[],
  userId: string,
): {
  employeeId: string;
  directReportIds: string[];
  indirectReportIds: string[];
} | null {
  const employee = employeeRows.find((row) => row.userId === userId);
  if (!employee) return null;

  const childrenByManager = new Map<string, string[]>();
  for (const row of employeeRows) {
    if (!row.managerEmployeeId || row.id === employee.id) continue;
    const children = childrenByManager.get(row.managerEmployeeId) ?? [];
    children.push(row.id);
    childrenByManager.set(row.managerEmployeeId, children);
  }

  const directReportIds = [...new Set(childrenByManager.get(employee.id) ?? [])].sort();
  const visited = new Set<string>([employee.id, ...directReportIds]);
  const indirectReportIds: string[] = [];
  const queue = [...directReportIds];

  while (queue.length > 0) {
    const managerId = queue.shift()!;
    for (const childId of childrenByManager.get(managerId) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      indirectReportIds.push(childId);
      queue.push(childId);
    }
  }

  return {
    employeeId: employee.id,
    directReportIds,
    indirectReportIds: indirectReportIds.sort(),
  };
}

function principalAliasTypes(userType: DpfSession["user"]["type"]): string[] {
  return userType === "admin" ? ["user"] : ["customer_contact", "partner_contact"];
}

export async function loadEffectiveAuthContext(
  input: LoadEffectiveAuthContextInput,
  db: EffectiveAuthContextDb = prisma as unknown as EffectiveAuthContextDb,
): Promise<EffectiveAuthContext> {
  const now = input.now ?? new Date();
  const aliasTypes = principalAliasTypes(input.user.type);

  const [principalAlias, employeeRows, teamMemberships, delegationGrants] = await Promise.all([
    db.principalAlias.findFirst({
      where: {
        aliasType: { in: aliasTypes },
        aliasValue: input.user.type === "admin" ? input.user.id : input.user.contactId ?? input.user.id,
        issuer: "",
      },
      include: {
        principal: {
          select: {
            principalId: true,
            kind: true,
            status: true,
            sensitivityClearance: true,
            aliases: {
              select: {
                aliasType: true,
                aliasValue: true,
                issuer: true,
              },
            },
          },
        },
      },
    }),
    input.user.type === "admin"
      ? db.employeeProfile.findMany({
          select: { id: true, userId: true, managerEmployeeId: true },
        })
      : Promise.resolve([]),
    input.user.type === "admin"
      ? db.teamMembership.findMany({
          where: { userId: input.user.id },
          select: { teamId: true },
        })
      : Promise.resolve([]),
    input.user.type === "admin" && input.actingAgentId
      ? db.delegationGrant.findMany({
          where: {
            grantorUserId: input.user.id,
            granteeAgent: { agentId: input.actingAgentId },
            status: "active",
            validFrom: { lte: now },
            expiresAt: { gt: now },
            OR: [{ targetUserId: null }, { targetUserId: input.user.id }],
          },
          select: { grantId: true, maxUses: true, useCount: true },
        })
      : Promise.resolve([]),
  ]);

  const principal = principalAlias?.principal ?? null;
  if (principal && principal.status !== "active") {
    throw new Error(`Principal ${principal.principalId} is not active`);
  }

  const managerScope =
    input.user.type === "admin" ? resolveManagerScope(employeeRows, input.user.id) : null;
  const activeDelegationGrantIds = delegationGrants
    .filter((grant) => grant.maxUses === null || grant.useCount < grant.maxUses)
    .map((grant) => grant.grantId);
  const population =
    principal?.kind === "partner"
      ? "partner"
      : input.user.type === "customer"
        ? "customer"
        : undefined;

  return buildEffectiveAuthContext({
    user: input.user,
    grantedCapabilities: input.grantedCapabilities,
    principal,
    population,
    employeeProfile: managerScope
      ? {
          id: managerScope.employeeId,
          directReportIds: managerScope.directReportIds,
          indirectReportIds: managerScope.indirectReportIds,
        }
      : null,
    teamIds: teamMemberships.map((membership) => membership.teamId),
    accountScope: {
      accountIds: input.user.accountId ? [input.user.accountId] : [],
      contactIds: input.user.contactId ? [input.user.contactId] : [],
      partnerAccountIds:
        population === "partner" && input.user.accountId ? [input.user.accountId] : [],
    },
    authentication: input.authentication,
    actingHumanUserId: input.user.type === "admin" ? input.user.id : null,
    actingAgentId: input.actingAgentId,
    delegationGrantIds: activeDelegationGrantIds,
  });
}
