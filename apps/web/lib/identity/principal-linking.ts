import crypto from "node:crypto";
import { prisma } from "@dpf/db";

type PrincipalDb = Pick<
  typeof prisma,
  "user" | "employeeProfile" | "agent" | "principal" | "principalAlias"
>;

type AliasRecord = {
  aliasType: string;
  aliasValue: string;
  issuer: string;
};

type PrincipalRecord = {
  id: string;
  principalId: string;
  kind: string;
  status: string;
  displayName: string;
};

export type SyncedPrincipal = PrincipalRecord & {
  aliases: AliasRecord[];
};

const INTERNAL_ISSUER = "";

function nextPrincipalId(): string {
  return `PRN-${crypto.randomUUID()}`;
}

function normalizeStatus(status?: string | null): string {
  if (!status) return "active";
  return status;
}

async function findPrincipalByAliases(
  db: PrincipalDb,
  aliases: AliasRecord[],
): Promise<PrincipalRecord | null> {
  for (const alias of aliases) {
    const match = await db.principalAlias.findFirst({
      where: {
        aliasType: alias.aliasType,
        aliasValue: alias.aliasValue,
        issuer: alias.issuer,
      },
      include: {
        principal: true,
      },
    });

    if (match?.principal) {
      return match.principal;
    }
  }

  return null;
}

async function persistPrincipalAliases(
  db: PrincipalDb,
  principal: PrincipalRecord,
  aliases: AliasRecord[],
): Promise<AliasRecord[]> {
  const aliasRows = aliases.map((alias) => ({
    principalId: principal.id,
    aliasType: alias.aliasType,
    aliasValue: alias.aliasValue,
    issuer: alias.issuer,
  }));

  if (aliasRows.length > 0) {
    await db.principalAlias.createMany({
      data: aliasRows,
      skipDuplicates: true,
    });
  }

  const persisted = await db.principalAlias.findMany({
    where: { principalId: principal.id },
  });

  return persisted.map((alias) => ({
    aliasType: alias.aliasType,
    aliasValue: alias.aliasValue,
    issuer: alias.issuer,
  }));
}

async function upsertPrincipalForAliases(
  db: PrincipalDb,
  input: {
    kind: PrincipalRecord["kind"];
    status?: string | null;
    displayName: string;
    aliases: AliasRecord[];
  },
): Promise<SyncedPrincipal> {
  const existing = await findPrincipalByAliases(db, input.aliases);
  const principal = existing
    ? await db.principal.update({
        where: { id: existing.id },
        data: {
          kind: input.kind,
          status: normalizeStatus(input.status),
          displayName: input.displayName,
        },
      })
    : await db.principal.create({
        data: {
          principalId: nextPrincipalId(),
          kind: input.kind,
          status: normalizeStatus(input.status),
          displayName: input.displayName,
        },
      });

  const aliases = await persistPrincipalAliases(db, principal, input.aliases);

  return {
    id: principal.id,
    principalId: principal.principalId,
    kind: principal.kind,
    status: principal.status,
    displayName: principal.displayName,
    aliases,
  };
}

export async function syncEmployeePrincipal(
  employeeProfileId: string,
  db: PrincipalDb = prisma,
): Promise<SyncedPrincipal> {
  const employee = await db.employeeProfile.findUnique({
    where: { id: employeeProfileId },
    select: {
      id: true,
      employeeId: true,
      userId: true,
      displayName: true,
      status: true,
      workEmail: true,
    },
  });

  if (!employee) {
    throw new Error(`Employee profile ${employeeProfileId} not found.`);
  }

  const aliases: AliasRecord[] = [
    {
      aliasType: "employee",
      aliasValue: employee.employeeId,
      issuer: INTERNAL_ISSUER,
    },
  ];

  if (employee.userId) {
    aliases.push({
      aliasType: "user",
      aliasValue: employee.userId,
      issuer: INTERNAL_ISSUER,
    });
  }

  return upsertPrincipalForAliases(db, {
    kind: "human",
    status: employee.status === "inactive" ? "inactive" : "active",
    displayName: employee.displayName,
    aliases,
  });
}

export async function syncUserPrincipal(
  userId: string,
  db: PrincipalDb = prisma,
): Promise<SyncedPrincipal> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      isActive: true,
      employeeProfile: {
        select: {
          id: true,
          employeeId: true,
          displayName: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error(`User ${userId} not found.`);
  }

  const aliases: AliasRecord[] = [
    {
      aliasType: "user",
      aliasValue: user.id,
      issuer: INTERNAL_ISSUER,
    },
  ];

  if (user.employeeProfile?.employeeId) {
    aliases.push({
      aliasType: "employee",
      aliasValue: user.employeeProfile.employeeId,
      issuer: INTERNAL_ISSUER,
    });
  }

  return upsertPrincipalForAliases(db, {
    kind: "human",
    status: user.isActive ? "active" : "inactive",
    displayName: user.employeeProfile?.displayName ?? user.email,
    aliases,
  });
}

export async function syncAgentPrincipal(
  agentId: string,
  db: PrincipalDb = prisma,
): Promise<SyncedPrincipal> {
  const agent = await db.agent.findUnique({
    where: { agentId },
    select: {
      id: true,
      agentId: true,
      name: true,
      status: true,
    },
  });

  if (!agent) {
    throw new Error(`Agent ${agentId} not found.`);
  }

  return upsertPrincipalForAliases(db, {
    kind: "agent",
    status: normalizeStatus(agent.status),
    displayName: agent.name,
    aliases: [
      {
        aliasType: "agent",
        aliasValue: agent.agentId,
        issuer: INTERNAL_ISSUER,
      },
    ],
  });
}

export async function resolvePrincipalIdForUser(
  userId: string,
  db: PrincipalDb = prisma,
): Promise<string | null> {
  const alias = await db.principalAlias.findFirst({
    where: {
      aliasType: "user",
      aliasValue: userId,
      issuer: INTERNAL_ISSUER,
    },
    include: {
      principal: {
        select: {
          principalId: true,
        },
      },
    },
  });

  return alias?.principal?.principalId ?? null;
}
