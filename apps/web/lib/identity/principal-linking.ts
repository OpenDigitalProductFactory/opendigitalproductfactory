import crypto from "node:crypto";
import { prisma } from "@dpf/db";
import {
  resolvePrincipalSensitivityClearance,
  type PrincipalSensitivity,
} from "@dpf/db/principal-sensitivity";

type PrincipalDb = Pick<
  typeof prisma,
  | "user"
  | "employeeProfile"
  | "agent"
  | "customerContact"
  | "principal"
  | "principalAlias"
>;

type PrincipalAliasDb = Pick<typeof prisma, "principalAlias">;

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
  sensitivityClearance: PrincipalSensitivity[];
};

export type SyncedPrincipal = PrincipalRecord & {
  aliases: AliasRecord[];
};

const INTERNAL_ISSUER = "";
const PRIVATE_GAID_ISSUER = "dpf.internal";

function nextPrincipalId(): string {
  return `PRN-${crypto.randomUUID()}`;
}

function normalizeStatus(status?: string | null): string {
  if (!status) return "active";
  return status;
}

function normalizeGaidLocalId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "agent";
}

export function buildPrivateAgentGaid(agentId: string): string {
  return `gaid:priv:${PRIVATE_GAID_ISSUER}:${normalizeGaidLocalId(agentId)}`;
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
    isSuperuser?: boolean;
  },
): Promise<SyncedPrincipal> {
  const existing = await findPrincipalByAliases(db, input.aliases);
  const nextStatus = normalizeStatus(input.status);
  const existingSensitivityClearance = existing?.sensitivityClearance ?? [];
  const sensitivityClearance = resolvePrincipalSensitivityClearance({
    existing: existingSensitivityClearance,
    isSuperuser: input.isSuperuser === true,
  });
  const clearanceChanged = existing
    ? existingSensitivityClearance.length !== sensitivityClearance.length ||
      existingSensitivityClearance.some(
        (value, index) => value !== sensitivityClearance[index],
      )
    : true;
  const principal = existing
    ? existing.kind === input.kind &&
        existing.status === nextStatus &&
        existing.displayName === input.displayName &&
        !clearanceChanged
      ? existing
      : await db.principal.update({
          where: { id: existing.id },
          data: {
            kind: input.kind,
            status: nextStatus,
            displayName: input.displayName,
            sensitivityClearance,
          },
        })
    : await db.principal.create({
        data: {
          principalId: nextPrincipalId(),
          kind: input.kind,
          status: nextStatus,
          displayName: input.displayName,
          sensitivityClearance,
        },
      });

  const aliases = await persistPrincipalAliases(db, principal, input.aliases);

  return {
    id: principal.id,
    principalId: principal.principalId,
    kind: principal.kind,
    status: principal.status,
    displayName: principal.displayName,
    sensitivityClearance: principal.sensitivityClearance,
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
      user: {
        select: {
          isSuperuser: true,
        },
      },
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
    isSuperuser: employee.user?.isSuperuser === true,
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
      isSuperuser: true,
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
    isSuperuser: user.isSuperuser,
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
      {
        aliasType: "gaid",
        aliasValue: buildPrivateAgentGaid(agent.agentId),
        issuer: INTERNAL_ISSUER,
      },
    ],
  });
}

export async function syncCustomerPrincipal(
  customerContactId: string,
  db: PrincipalDb = prisma,
): Promise<SyncedPrincipal> {
  const contact = await db.customerContact.findUnique({
    where: { id: customerContactId },
    select: {
      id: true,
      email: true,
      isActive: true,
    },
  });

  if (!contact) {
    throw new Error(`CustomerContact ${customerContactId} not found.`);
  }

  const lowercaseEmail = contact.email.toLowerCase();

  return upsertPrincipalForAliases(db, {
    kind: "customer",
    status: contact.isActive ? "active" : "inactive",
    displayName: contact.email,
    aliases: [
      {
        aliasType: "customer_contact",
        aliasValue: contact.id,
        issuer: INTERNAL_ISSUER,
      },
      {
        aliasType: "email",
        aliasValue: lowercaseEmail,
        issuer: INTERNAL_ISSUER,
      },
    ],
  });
}

/**
 * Sync the Principal for a PARTNER contact — a person at a partner org (e.g. a
 * local IT MSP that resells and operates installs for its local customers).
 * EP-PARTNER-CHANNEL Phase 2 (BI-DE47EC0B).
 *
 * Convergence contract (AGENTS §11): there is NO parallel partner identity
 * table. A partner contact is the same CustomerContact party row as any other
 * contact; what makes them a partner is that their ACCOUNT carries a live
 * PartnerProgramEnrollment. So:
 *
 *   - `kind` is DERIVED from the account's enrolment, never passed in. That
 *     makes the value deterministic and prevents two callers flapping the same
 *     principal between "customer" and "partner".
 *   - A contact whose account has no live enrolment is rejected outright rather
 *     than silently promoted to partner.
 *   - The `partner_contact` alias sits ALONGSIDE the shared `email` alias, so a
 *     person who was already synced as a customer contact converges onto the
 *     SAME principal (found by email) and is re-kinded, rather than gaining a
 *     second identity.
 *
 * An org that is both a customer and a partner is expected and supported — the
 * enrolment is additive, not an exclusive discriminator.
 */
export async function syncPartnerPrincipal(
  customerContactId: string,
  db: PrincipalDb = prisma,
): Promise<SyncedPrincipal> {
  const contact = await db.customerContact.findUnique({
    where: { id: customerContactId },
    select: {
      id: true,
      email: true,
      isActive: true,
      account: {
        select: {
          accountId: true,
          partnerEnrollment: { select: { status: true, endedAt: true } },
        },
      },
    },
  });

  if (!contact) {
    throw new Error(`CustomerContact ${customerContactId} not found.`);
  }

  const enrollment = contact.account?.partnerEnrollment;
  const enrolled = Boolean(enrollment) && enrollment!.status !== "ended" && enrollment!.endedAt == null;
  if (!enrolled) {
    throw new Error(
      `CustomerContact ${customerContactId} is not a partner contact: account ${contact.account?.accountId ?? "(none)"} has no live PartnerProgramEnrollment.`,
    );
  }

  const lowercaseEmail = contact.email.toLowerCase();

  return upsertPrincipalForAliases(db, {
    kind: "partner",
    status: contact.isActive ? "active" : "inactive",
    displayName: contact.email,
    aliases: [
      {
        aliasType: "partner_contact",
        aliasValue: contact.id,
        issuer: INTERNAL_ISSUER,
      },
      {
        aliasType: "email",
        aliasValue: lowercaseEmail,
        issuer: INTERNAL_ISSUER,
      },
    ],
  });
}

/**
 * Resolve the principal kind a contact should carry, from its account's partner
 * enrolment. Exported so callers that sync a contact generically (customer OR
 * partner) apply the SAME derivation rule instead of guessing.
 */
export function principalKindForContact(input: {
  partnerEnrollment?: { status: string; endedAt: Date | null } | null;
}): "customer" | "partner" {
  const e = input.partnerEnrollment;
  if (e && e.status !== "ended" && e.endedAt == null) return "partner";
  return "customer";
}

export async function ensureAgentPrincipalIdentity(
  agentId: string,
  db: PrincipalDb = prisma,
): Promise<SyncedPrincipal | null> {
  try {
    return await syncAgentPrincipal(agentId, db);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return null;
    }
    throw error;
  }
}

export async function getAgentGaidMap(
  agentIds: string[],
  db: PrincipalAliasDb = prisma,
): Promise<Map<string, string>> {
  const uniqueAgentIds = [...new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean))];
  if (uniqueAgentIds.length === 0) {
    return new Map();
  }

  const agentAliases = await db.principalAlias.findMany({
    where: {
      aliasType: "agent",
      aliasValue: { in: uniqueAgentIds },
      issuer: INTERNAL_ISSUER,
    },
    select: {
      principalId: true,
      aliasValue: true,
    },
  });

  if (agentAliases.length === 0) {
    return new Map();
  }

  const gaidAliases = await db.principalAlias.findMany({
    where: {
      aliasType: "gaid",
      principalId: { in: agentAliases.map((alias) => alias.principalId) },
      issuer: INTERNAL_ISSUER,
    },
    select: {
      principalId: true,
      aliasValue: true,
    },
  });

  const gaidByPrincipalId = new Map(gaidAliases.map((alias) => [alias.principalId, alias.aliasValue]));

  return new Map(
    agentAliases.flatMap((alias) => {
      const gaid = gaidByPrincipalId.get(alias.principalId);
      return gaid ? [[alias.aliasValue, gaid] as const] : [];
    }),
  );
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

/**
 * Resolve the relational Principal.id used by healthcare foreign keys and
 * patient-authority comparisons. This is deliberately distinct from the
 * public Principal.principalId returned by resolvePrincipalIdForUser.
 */
export async function resolvePrincipalRecordIdForSessionIdentity(
  identity: { type: "admin" | "customer"; id: string },
  db: PrincipalDb = prisma,
): Promise<string | null> {
  const alias = await db.principalAlias.findFirst({
    where: {
      aliasType: identity.type === "admin" ? "user" : "customer_contact",
      aliasValue: identity.id,
      issuer: INTERNAL_ISSUER,
    },
    include: {
      principal: {
        select: { id: true },
      },
    },
  });
  return alias?.principal?.id ?? null;
}

/**
 * Resolve the Principal id behind an agent (coworker) id, via the
 * `aliasType: "agent"` PrincipalAlias (principal-convergence, AGENTS.md §11).
 * Sibling of resolvePrincipalIdForUser; used by decision caller-context
 * resolution so a coworker decision can be attributed to its principal.
 */
export async function resolvePrincipalIdForAgent(
  agentId: string,
  db: PrincipalDb = prisma,
): Promise<string | null> {
  const alias = await db.principalAlias.findFirst({
    where: {
      aliasType: "agent",
      aliasValue: agentId,
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
