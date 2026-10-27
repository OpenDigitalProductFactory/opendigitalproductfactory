import { randomUUID } from "node:crypto";
import { isRecord } from "../shared/coerce";
import { ok, type ActionResult } from "../shared/action-result";
import { validateBalancePolicy, type BalancePolicy, type InvestmentOwnerKind, type InvestmentPurpose } from "./investment-balance";

export type FundingScope = { principalId: string; organizationId: string; purpose: InvestmentPurpose };
/** Server-resolved canonical identity facts; never accept these from tool parameters. */
export type FundingAuthorityFacts = {
  activePerson: boolean;
  activeAccount: boolean;
  organizationExists: boolean;
  resolvedOrganizationId: string | null;
  founderPrincipalId: string | null;
  founderOrganizationId: string | null;
  organizationOwnerPrincipalId: string | null;
};
export function fundingAuthority(scope: FundingScope, facts: FundingAuthorityFacts): InvestmentOwnerKind | null {
  if (!facts.activePerson || !facts.activeAccount) return null;
  return recordedFundingOwner(scope, facts);
}
/** Disabled accounts lose execution authority, but that alone never transfers ownership. */
export function recordedFundingOwner(scope: FundingScope, facts: FundingAuthorityFacts): InvestmentOwnerKind | null {
  if (!scope.principalId || !scope.organizationId || !facts.organizationExists
    || facts.resolvedOrganizationId !== scope.organizationId) return null;
  if (scope.purpose !== "shared-platform" && scope.purpose !== "archetype") return null;
  if (scope.principalId === facts.founderPrincipalId && scope.organizationId === facts.founderOrganizationId) return "founder";
  if (scope.principalId === facts.organizationOwnerPrincipalId) return "organization";
  return null;
}

export function policyScopeKey(scope: FundingScope): string {
  return `investment-balance.v1:${JSON.stringify([scope.organizationId, scope.principalId, scope.purpose])}`;
}
export type PolicyRevision = {
  version: 1;
  revision: string;
  previousRevision: string | null;
  scope: FundingScope;
  policy: BalancePolicy;
  actorPrincipalId: string;
  reason: string;
  effectiveAt: string;
  expiresAt: string | null;
};
type ConfigDb = {
  platformConfig: {
    findUnique(args: unknown): Promise<{ value: unknown } | null>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};
export type BalancePolicyDb = ConfigDb & { $transaction<T>(fn: (tx: ConfigDb) => Promise<T>): Promise<T> };

function parseRevision(value: unknown, scope: FundingScope, revision: string): PolicyRevision | null {
  if (!isRecord(value) || value.version !== 1 || value.revision !== revision || !isRecord(value.scope)
    || value.scope.principalId !== scope.principalId || value.scope.organizationId !== scope.organizationId || value.scope.purpose !== scope.purpose
    || !validateBalancePolicy(value.policy) || typeof value.actorPrincipalId !== "string" || !value.actorPrincipalId
    || typeof value.reason !== "string" || !value.reason.trim() || typeof value.effectiveAt !== "string" || !Number.isFinite(Date.parse(value.effectiveAt))
    || !(value.previousRevision === null || typeof value.previousRevision === "string")
    || !(value.expiresAt === null || (typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt))))) return null;
  return value as PolicyRevision;
}

/** Historical reads retain their original authority; callers separately validate current authority. */
export async function readPolicyRevision(db: ConfigDb, scope: FundingScope, revision: string): Promise<PolicyRevision | null> {
  if (!/^[0-9a-f-]{36}$/.test(revision)) return null;
  const row = await db.platformConfig.findUnique({ where: { key: `${policyScopeKey(scope)}:revision:${revision}` } });
  return parseRevision(row?.value, scope, revision);
}

/** Owner inspection can read an expired revision to create a governed successor. */
export async function readStoredCurrentPolicy(db: ConfigDb, scope: FundingScope): Promise<ActionResult<PolicyRevision | null>> {
  const row = await db.platformConfig.findUnique({ where: { key: `${policyScopeKey(scope)}:current` } });
  if (!row) return ok(null);
  if (!isRecord(row.value) || typeof row.value.revision !== "string") return { ok: false, error: "malformed-policy" };
  const revision = await readPolicyRevision(db, scope, row.value.revision);
  if (!revision) return { ok: false, error: "malformed-policy" };
  return ok(revision);
}

export function policyRevisionIsActive(revision: PolicyRevision, now: Date): boolean {
  return Number.isFinite(now.getTime()) && Date.parse(revision.effectiveAt) <= now.getTime()
    && (revision.expiresAt === null || Date.parse(revision.expiresAt) > now.getTime());
}

export async function readCurrentPolicy(db: ConfigDb, scope: FundingScope, now = new Date()): Promise<ActionResult<PolicyRevision | null>> {
  const stored = await readStoredCurrentPolicy(db, scope);
  if (!stored.ok || stored.data === null) return stored;
  return policyRevisionIsActive(stored.data, now) ? stored : { ok: false, error: "inactive-policy" };
}

class StalePolicy extends Error {}
export async function writePolicyRevision(db: BalancePolicyDb, input: {
  scope: FundingScope;
  policy: BalancePolicy;
  expectedRevision: string | null;
  actorPrincipalId: string;
  reason: string;
  authority: FundingAuthorityFacts;
  expiresAt?: string | null;
  now?: Date;
}): Promise<ActionResult<PolicyRevision>> {
  if (!fundingAuthority(input.scope, input.authority)) return { ok: false, error: "unresolved-authority" };
  if (input.actorPrincipalId !== input.scope.principalId) return { ok: false, error: "not-owner" };
  if (!input.reason.trim()) return { ok: false, error: "reason-required" };
  if (!validateBalancePolicy(input.policy)) return { ok: false, error: "invalid-policy" };
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || (input.expiresAt != null && (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now.getTime())))
    return { ok: false, error: "invalid-validity" };
  const key = policyScopeKey(input.scope);
  const revision: PolicyRevision = {
    version: 1, revision: randomUUID(), previousRevision: input.expectedRevision,
    scope: { ...input.scope }, policy: { ...input.policy }, actorPrincipalId: input.actorPrincipalId,
    reason: input.reason.trim(), effectiveAt: now.toISOString(), expiresAt: input.expiresAt ?? null,
  };
  try {
    await db.$transaction(async (tx) => {
      const current = await tx.platformConfig.findUnique({ where: { key: `${key}:current` } });
      if (current ? !isRecord(current.value) || current.value.revision !== input.expectedRevision : input.expectedRevision !== null) throw new StalePolicy();
      await tx.platformConfig.create({ data: { key: `${key}:revision:${revision.revision}`, value: revision } });
      const value = { revision: revision.revision };
      if (!current) await tx.platformConfig.create({ data: { key: `${key}:current`, value } });
      else {
        const changed = await tx.platformConfig.updateMany({ where: { key: `${key}:current`, value: { equals: current.value } }, data: { value } });
        if (changed.count !== 1) throw new StalePolicy();
      }
    });
    return ok(revision);
  } catch (error) {
    if (error instanceof StalePolicy || (isRecord(error) && (error.code === "P2002" || error.code === "P2034"))) return { ok: false, error: "stale-revision" };
    throw error;
  }
}
