import type { Prisma, PrismaClient } from "@dpf/db";
import { WWMD_PLATFORM_PROFILE_ID } from "../decision/caller-context";
import { FEDERATION_IDENTITY_KEY } from "../install/installation-device-id";
import { isDeviceId } from "../federation/instance-identity";
import { isRecord } from "../shared/coerce";
import { ok, type ActionResult } from "../shared/action-result";
import { classifyInvestment, defaultBalancePolicy, evaluateInvestmentBalance, formatInvestmentGuidance, type BalancePolicy, type InvestmentOwnerKind } from "./investment-balance";
import type { InvestmentAttemptSnapshot } from "../routing/adapter-telemetry-writer";
import { policyScopeKey } from "./investment-balance-policy";
import { fundingAuthority, recordedFundingOwner, readCurrentPolicy, readStoredCurrentPolicy, policyRevisionIsActive, writePolicyRevision, type BalancePolicyDb, type FundingAuthorityFacts, type FundingScope, type PolicyRevision } from "./investment-balance-policy";
import { resolvePrincipalRecordIdForSessionIdentity } from "../identity/principal-linking";
import { parseFundingScope, resolveRoomFunding, ROOM_INVESTMENT_FIELD, type ItemInvestmentClassification } from "./investment-balance-binding";
import { loadInvestmentObservation, loadUnassignedInvestmentAttempts } from "./investment-balance-observation";

export type InvestmentIdentityDb = Pick<Prisma.TransactionClient, "principal" | "principalAlias" | "user" | "organization" | "decisionPerspectiveProfile" | "platformConfig">;

/** Identity only: no installer name, environment class, executor or admin fallback. */
export async function loadFundingAuthority(db: InvestmentIdentityDb, scope: FundingScope): Promise<FundingAuthorityFacts> {
  const [principal, aliases, organization, profile] = await Promise.all([
    db.principal.findUnique({ where: { id: scope.principalId }, select: { id: true, kind: true, status: true } }),
    db.principalAlias.findMany({ where: { principalId: scope.principalId, aliasType: "user", issuer: "" }, select: { aliasValue: true } }),
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { id: true, topAccountablePrincipalId: true } }),
    db.decisionPerspectiveProfile.findUnique({ where: { profileId: WWMD_PLATFORM_PROFILE_ID }, select: { ownerPrincipalId: true, ownerOrganizationId: true, status: true } }),
  ]);
  const user = aliases.length > 0 ? await db.user.findFirst({ where: { id: { in: aliases.map((a) => a.aliasValue) }, isActive: true }, select: { id: true } }) : null;
  return {
    activePerson: principal?.kind === "human" && principal.status === "active",
    activeAccount: user !== null,
    organizationExists: organization !== null,
    resolvedOrganizationId: organization?.id ?? null,
    founderPrincipalId: profile?.status === "active" ? profile.ownerPrincipalId : null,
    founderOrganizationId: profile?.status === "active" ? profile.ownerOrganizationId : null,
    organizationOwnerPrincipalId: organization?.topAccountablePrincipalId ?? null,
  };
}

export type ScopedBalancePolicy = {
  scope: FundingScope;
  ownerKind: InvestmentOwnerKind;
  source: "default" | "explicit";
  policy: BalancePolicy;
  revision: PolicyRevision | null;
  classification?: ItemInvestmentClassification;
};
export async function loadScopedBalancePolicy(db: InvestmentIdentityDb, scope: FundingScope, now = new Date()): Promise<ActionResult<ScopedBalancePolicy>> {
  const authority = fundingAuthority(scope, await loadFundingAuthority(db, scope));
  if (!authority) return { ok: false, error: "unresolved-authority" };
  const current = await readCurrentPolicy(db as never, scope, now);
  if (!current.ok) return current;
  return ok({ scope, ownerKind: authority, source: current.data ? "explicit" : "default", policy: current.data?.policy ?? defaultBalancePolicy(authority, scope.purpose), revision: current.data });
}

/** Read-only identity. A missing identity keeps spending unassigned. */
export async function readInvestmentInstallationId(db: Pick<InvestmentIdentityDb, "platformConfig">): Promise<string | null> {
  const row = await db.platformConfig.findUnique({ where: { key: FEDERATION_IDENTITY_KEY }, select: { value: true } });
  return isRecord(row?.value) && isDeviceId(row.value.deviceId) ? row.value.deviceId : null;
}

class PolicyWriteRejected extends Error {
  constructor(readonly result: ActionResult<PolicyRevision>) { super("Policy transaction rejected"); }
}
export async function saveScopedBalancePolicy(db: PrismaClient, input: {
  userId: string; scope: FundingScope; policy: BalancePolicy; expectedRevision: string | null; reason: string; expiresAt?: string | null;
}): Promise<ActionResult<PolicyRevision>> {
  try { return await db.$transaction(async (tx) => {
    const actorPrincipalId = await resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id: input.userId }, tx as never);
    if (!actorPrincipalId) return { ok: false, error: "actor-required" };
    // Authority and revision are read in the same transaction, never supplied by the client.
    const result = await writePolicyRevision({ platformConfig: tx.platformConfig, $transaction: (fn: Parameters<BalancePolicyDb["$transaction"]>[0]) => fn(tx as never) } as never, {
      ...input, actorPrincipalId, authority: await loadFundingAuthority(tx, input.scope),
    });
    // The nested policy adapter reports CAS failures as results; throw through
    // the owning transaction so a losing revision can never be committed alone.
    if (!result.ok) throw new PolicyWriteRejected(result);
    return result;
  }, { isolationLevel: "Serializable" }); } catch (error) {
    if (error instanceof PolicyWriteRejected) return error.result;
    if (isRecord(error) && (error.code === "P2002" || error.code === "P2034")) return { ok: false, error: "stale-revision" };
    throw error;
  }
}

export type FundingTarget = { kind: "installation"; purpose: FundingScope["purpose"] }
  | { kind: "portfolio"; id: string; purpose: FundingScope["purpose"] }
  | { kind: "workroom"; id: string; itemId: string };
type FundingBinding = { version: 1; scope: FundingScope; installationRef: string; actorPrincipalId: string; reason: string; boundAt: string; classification?: "refactor" | "new" | null; portfolioAccountablePrincipalId?: string | null };
const bindingKey = (target: Exclude<FundingTarget, { kind: "workroom" }>, installationRef: string, organizationId: string) =>
  `investment-balance.v1:binding:${JSON.stringify([installationRef, organizationId, target.kind, target.kind === "portfolio" ? target.id : null, target.purpose])}`;

function parseBinding(raw: unknown, installationRef: string): FundingBinding | null {
  if (!isRecord(raw) || raw.version !== 1 || raw.installationRef !== installationRef) return null;
  const scope = parseFundingScope(raw.scope);
  if (!scope || typeof raw.actorPrincipalId !== "string" || typeof raw.reason !== "string" || typeof raw.boundAt !== "string" || !Number.isFinite(Date.parse(raw.boundAt))) return null;
  if (raw.classification !== undefined && raw.classification !== null && raw.classification !== "refactor" && raw.classification !== "new") return null;
  if (raw.portfolioAccountablePrincipalId !== undefined && raw.portfolioAccountablePrincipalId !== null && typeof raw.portfolioAccountablePrincipalId !== "string") return null;
  return { version: 1, scope, installationRef, actorPrincipalId: raw.actorPrincipalId, reason: raw.reason, boundAt: raw.boundAt, ...(raw.classification !== undefined ? { classification: raw.classification } : {}), ...(raw.portfolioAccountablePrincipalId !== undefined ? { portfolioAccountablePrincipalId: raw.portfolioAccountablePrincipalId } : {}) };
}

/** Explicit funding binding. Changing a coordinator never calls this function. */
export async function bindInvestmentFunding(db: PrismaClient, input: {
  userId: string; agentId?: string; scope: FundingScope; target: FundingTarget; expectedBoundAt: string | null; reason: string; classification?: "refactor" | "new" | null;
}): Promise<ActionResult<FundingBinding>> {
  if (!input.reason.trim()) return { ok: false, error: "reason-required" };
  if (input.classification !== undefined && (input.target.kind !== "workroom" || input.target.itemId === "*" || (input.classification !== null && input.classification !== "refactor" && input.classification !== "new"))) return { ok: false, error: "item-classification-required" };
  return db.$transaction(async (tx) => {
    const principalId = await resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id: input.userId }, tx as never);
    if (principalId !== input.scope.principalId) return { ok: false, error: "not-owner" };
    const policy = await loadScopedBalancePolicy(tx, input.scope);
    if (!policy.ok) return policy;
    const installationRef = await readInvestmentInstallationId(tx);
    if (!installationRef) return { ok: false, error: "installation-unresolved" };
    const value: FundingBinding = { version: 1, scope: input.scope, installationRef, actorPrincipalId: principalId, reason: input.reason.trim(), boundAt: new Date().toISOString(), ...(input.classification !== undefined ? { classification: input.classification } : {}) };
    if (input.target.kind === "workroom") {
      const room = await tx.workroom.findUnique({ where: { capsuleId: input.target.id } });
      if (!room) return { ok: false, error: "unknown-workroom" };
      const access = await import("../work-management/workroom-agent-access.server");
      const admission = input.agentId
        ? await access.resolveAgentWorkroomAccess({ userId: input.userId, agentId: input.agentId, workroomId: room.id, requested: "action" }, tx)
        : await access.resolveHumanWorkroomAccess({ userId: input.userId, workroomId: room.id, requested: "action" }, tx);
      if (admission.decision.level !== "action") return { ok: false, error: "room-access-required" };
      if (input.target.itemId !== "*") {
        const item = await tx.backlogItem.findUnique({ where: { itemId: input.target.itemId }, select: { id: true, organizationId: true } });
        if (!item) return { ok: false, error: "unknown-item" };
        if (item.organizationId && item.organizationId !== input.scope.organizationId) return { ok: false, error: "funding-organization-mismatch" };
      }
      if (!isRecord(room.promotionPolicy)) return { ok: false, error: "malformed-funding" };
      const envelope = room.promotionPolicy[ROOM_INVESTMENT_FIELD];
      if (envelope !== undefined && (!isRecord(envelope) || !isRecord(envelope.bindings))) return { ok: false, error: "malformed-funding" };
      const bindings = isRecord(envelope) && isRecord(envelope.bindings) ? envelope.bindings : {};
      const oldRaw = bindings[input.target.itemId];
      // A cloned room stays unresolved until its owner explicitly rebinds it here.
      // Retain the original installation in the audit event instead of silently adopting it.
      const oldInstallation = isRecord(oldRaw) && typeof oldRaw.installationRef === "string" && isDeviceId(oldRaw.installationRef) ? oldRaw.installationRef : installationRef;
      const old = oldRaw === undefined ? null : parseBinding(oldRaw, oldInstallation);
      if (oldRaw !== undefined && !old) return { ok: false, error: "malformed-funding" };
      if ((old?.boundAt ?? null) !== input.expectedBoundAt) return { ok: false, error: "stale-binding" };
      if (old && Date.parse(value.boundAt) <= Date.parse(old.boundAt)) value.boundAt = new Date(Date.parse(old.boundAt) + 1).toISOString();
      if (input.classification === undefined && old?.classification !== undefined) value.classification = old.classification;
      if (old && old.scope.principalId !== principalId && recordedFundingOwner(old.scope, await loadFundingAuthority(tx, old.scope))) return { ok: false, error: "funding-transfer-required" };
      const changed = await tx.workroom.updateMany({ where: { id: room.id, updatedAt: room.updatedAt }, data: {
        promotionPolicy: { ...room.promotionPolicy, [ROOM_INVESTMENT_FIELD]: { bindings: { ...bindings, [input.target.itemId]: value } } } as Prisma.InputJsonValue,
      } });
      if (changed.count !== 1) return { ok: false, error: "stale-binding" };
      await tx.workroomActivity.create({ data: { workCapsuleId: room.id, kind: "investment-funding-bound", summary: input.reason.trim(), payload: { target: input.target, previous: old, binding: value } as Prisma.InputJsonValue } });
      return ok(value);
    }
    if (input.target.purpose !== input.scope.purpose) return { ok: false, error: "purpose-mismatch" };
    if (input.target.kind === "portfolio") {
      const portfolio = await tx.portfolio.findUnique({ where: { id: input.target.id }, select: { accountablePrincipalId: true } });
      if (!portfolio) return { ok: false, error: "unknown-portfolio" };
      // Portfolio is a shared taxonomy, not an organization. This owner funds
      // only its organization's matching items through the organization-scoped key.
      // Accountability remains a separate role and never grants spending authority.
      value.portfolioAccountablePrincipalId = portfolio.accountablePrincipalId;
    }
    const key = bindingKey(input.target, installationRef, input.scope.organizationId);
    const row = await tx.platformConfig.findUnique({ where: { key } });
    const previous = row ? parseBinding(row.value, installationRef) : null;
    if (row && !previous) return { ok: false, error: "malformed-funding" };
    if ((previous?.boundAt ?? null) !== input.expectedBoundAt) return { ok: false, error: "stale-binding" };
    if (previous && Date.parse(value.boundAt) <= Date.parse(previous.boundAt)) value.boundAt = new Date(Date.parse(previous.boundAt) + 1).toISOString();
    if (previous && previous.scope.principalId !== principalId && recordedFundingOwner(previous.scope, await loadFundingAuthority(tx, previous.scope))) return { ok: false, error: "funding-transfer-required" };
    // Archive every binding change under an immutable key before replacing its current pointer.
    await tx.platformConfig.create({ data: { key: `${key}:history:${crypto.randomUUID()}`, value: value as unknown as Prisma.InputJsonValue } });
    if (!row) await tx.platformConfig.create({ data: { key, value: value as unknown as Prisma.InputJsonValue } });
    else await tx.platformConfig.update({ where: { key }, data: { value: value as unknown as Prisma.InputJsonValue } });
    return ok(value);
  }, { isolationLevel: "Serializable" });
}

type FundingReadDb = InvestmentIdentityDb & Pick<Prisma.TransactionClient, "backlogItem" | "workroom" | "portfolio">;
/** Per funded item: room, nearest parents, portfolio, install. Missing authority stays unresolved. */
export async function loadItemBalancePolicy(db: FundingReadDb, input: { itemId: string; roomId?: string }, now = new Date()): Promise<ActionResult<ScopedBalancePolicy>> {
  const item = await db.backlogItem.findFirst({ where: { OR: [{ itemId: input.itemId }, { id: input.itemId }] }, select: { id: true, itemId: true, scopeKind: true, portfolioId: true, organizationId: true } });
  if (!item) return { ok: false, error: "unknown-item" };
  const installationRef = await readInvestmentInstallationId(db);
  if (!installationRef) return { ok: false, error: "installation-unresolved" };
  const rooms = await db.workroom.findMany({ where: input.roomId ? { OR: [{ id: input.roomId }, { capsuleId: input.roomId }] } : { backlogItemId: { in: [item.id, item.itemId] }, archivedAt: null }, select: { id: true }, take: 65 });
  if (input.roomId && rooms.length === 0) return { ok: false, error: "unknown-workroom" };
  if (rooms.length > 64) return { ok: false, error: "funding-overflow" };
  let scope: FundingScope | null = null;
  let classification: ItemInvestmentClassification | undefined;
  for (const room of rooms) {
    const result = await resolveRoomFunding(room.id, item.itemId, async (id) => {
      const row = await db.workroom.findUnique({ where: { id }, select: { id: true, promotionPolicy: true, incomingRelations: { where: { relation: "contains" }, select: { fromWorkroomId: true }, take: 65 } } });
      return row ? { id: row.id, promotionPolicy: row.promotionPolicy, parentIds: row.incomingRelations.map((r) => r.fromWorkroomId) } : null;
    }, installationRef);
    if (!result.ok) return result;
    if (result.data) {
      const candidate = result.data.scope;
      if (item.organizationId && item.organizationId !== candidate.organizationId) return { ok: false, error: "funding-organization-mismatch" };
      if (scope && (scope.principalId !== candidate.principalId || scope.organizationId !== candidate.organizationId || scope.purpose !== candidate.purpose)) return { ok: false, error: "conflicting-funding" };
      if (scope && classification?.value !== result.data.classification?.value) return { ok: false, error: "conflicting-classification" };
      scope = candidate;
      classification = result.data.classification;
    }
  }
  if (scope) {
    const policy = await loadScopedBalancePolicy(db, scope, now);
    return policy.ok ? ok({ ...policy.data, ...(classification ? { classification } : {}) }) : policy;
  }
  const purpose: FundingScope["purpose"] | null = item.scopeKind === "platform" || item.scopeKind === "common" ? "shared-platform"
    : ["archetype-category", "archetype-leaf", "multi-archetype"].includes(item.scopeKind ?? "") ? "archetype" : null;
  if (!purpose) return { ok: false, error: "purpose-unresolved" };
  // Organization-scoped installation defaults coexist. Unowned platform work can
  // look up the canonical platform organization's explicit binding, never a guessed owner.
  const organizationId = item.organizationId ?? (purpose === "shared-platform"
    ? (await db.decisionPerspectiveProfile.findUnique({ where: { profileId: WWMD_PLATFORM_PROFILE_ID }, select: { ownerOrganizationId: true } }))?.ownerOrganizationId
    : null);
  if (!organizationId) return { ok: false, error: "funding-organization-unresolved" };
  const targets: Exclude<FundingTarget, { kind: "workroom" }>[] = [
    ...(item.portfolioId ? [{ kind: "portfolio" as const, id: item.portfolioId, purpose }] : []), { kind: "installation", purpose },
  ];
  for (const target of targets) {
    const row = await db.platformConfig.findUnique({ where: { key: bindingKey(target, installationRef, organizationId) } });
    if (!row) continue;
    const binding = parseBinding(row.value, installationRef);
    if (!binding || binding.scope.purpose !== purpose) return { ok: false, error: "malformed-funding" };
    if (item.organizationId && item.organizationId !== binding.scope.organizationId) return { ok: false, error: "funding-organization-mismatch" };
    if (target.kind === "portfolio") {
      const portfolio = await db.portfolio.findUnique({ where: { id: target.id }, select: { accountablePrincipalId: true } });
      if (!portfolio || binding.portfolioAccountablePrincipalId === undefined || portfolio.accountablePrincipalId !== binding.portfolioAccountablePrincipalId) return { ok: false, error: "portfolio-accountability-changed" };
    }
    return loadScopedBalancePolicy(db, binding.scope, now);
  }
  return { ok: false, error: "funding-unresolved" };
}

export const UNRESOLVED_INVESTMENT_GUIDANCE = "Funding allocation is unresolved. Do not infer founder or organization allocation from this installation, executor, coordinator or administrator role. Read the Workroom's funding scope before making budget decisions.";

export async function projectItemInvestment(db: FundingReadDb, input: { itemId: string; roomId?: string }) {
  try {
    const resolved = await loadItemBalancePolicy(db, input);
    if (!resolved.ok) return { resolved: false as const, reason: resolved.error, guidance: UNRESOLVED_INVESTMENT_GUIDANCE };
    return { resolved: true as const, ...resolved.data, guidance: formatInvestmentGuidance(resolved.data) };
  } catch {
    return { resolved: false as const, reason: "allocation-read-unavailable", guidance: UNRESOLVED_INVESTMENT_GUIDANCE };
  }
}

export async function loadScopedBalanceReport(db: InvestmentIdentityDb & Pick<Prisma.TransactionClient, "$queryRaw">, scope: FundingScope) {
  const ownerKind = fundingAuthority(scope, await loadFundingAuthority(db, scope));
  if (!ownerKind) return { ok: false as const, error: "unresolved-authority" };
  const stored = await readStoredCurrentPolicy(db as never, scope);
  if (!stored.ok) return stored;
  const policy = stored.data?.policy ?? defaultBalancePolicy(ownerKind, scope.purpose);
  const value: ScopedBalancePolicy = { scope, ownerKind, policy, revision: stored.data, source: stored.data ? "explicit" : "default" };
  const installationRef = await readInvestmentInstallationId(db);
  if (!installationRef) return { ok: false as const, error: "installation-unresolved" };
  const now = new Date();
  const policyActive = stored.data === null || policyRevisionIsActive(stored.data, now);
  const observed = await loadInvestmentObservation(db, { scope, installationRef, windowDays: policy.windowDays, now });
  const attributionGap = { level: ownerKind === "founder" ? "installation" as const : "organization" as const,
    unassignedAttempts: await loadUnassignedInvestmentAttempts(db, policy.windowDays, now, ownerKind === "founder" ? null : scope.organizationId) };
  const row = await db.platformConfig.findUnique({ where: { key: bindingKey({ kind: "installation", purpose: scope.purpose }, installationRef, scope.organizationId) } });
  const binding = row ? parseBinding(row.value, installationRef) : null;
  const canSucceedBinding = binding !== null && binding.scope.organizationId === scope.organizationId
    && binding.scope.principalId !== scope.principalId && !recordedFundingOwner(binding.scope, await loadFundingAuthority(db, binding.scope));
  return ok({ ...value, policyActive, guidance: policyActive ? formatInvestmentGuidance(value) : UNRESOLVED_INVESTMENT_GUIDANCE,
    observation: evaluateInvestmentBalance(policyActive ? policy : { ...policy, steeringEnabled: false }, observed, now),
    installationBinding: binding, canSucceedBinding, attributionGap, externalInferenceCoverage: "unobserved" as const });
}

/** Only scopes canonically owned by the signed-in person are projected into the settings UI. */
export type OwnerInvestmentView = { scope: FundingScope; organizationName: string; report: Awaited<ReturnType<typeof loadScopedBalanceReport>> };
export async function loadOwnerInvestmentPage(db: PrismaClient, userId: string, afterOrganizationId: string | null = null): Promise<{ views: OwnerInvestmentView[]; nextCursor: string | null }> {
  const principalId = await resolvePrincipalRecordIdForSessionIdentity({ type: "admin", id: userId }, db as never);
  if (!principalId) return { views: [], nextCursor: null };
  const profile = await db.decisionPerspectiveProfile.findUnique({ where: { profileId: WWMD_PLATFORM_PROFILE_ID }, select: { ownerPrincipalId: true, ownerOrganizationId: true, status: true } });
  const founderOrg = profile?.status === "active" && profile.ownerPrincipalId === principalId ? profile.ownerOrganizationId : null;
  const organizations = await db.organization.findMany({ where: { OR: [{ topAccountablePrincipalId: principalId }, ...(founderOrg ? [{ id: founderOrg }] : [])], ...(afterOrganizationId ? { id: { gt: afterOrganizationId } } : {}) }, select: { id: true, name: true }, orderBy: { id: "asc" }, take: 17 });
  const page = organizations.slice(0, 16);
  const views: OwnerInvestmentView[] = [];
  for (const organization of page) for (const purpose of ["shared-platform", "archetype"] as const) {
    const scope = { principalId, organizationId: organization.id, purpose };
    const report = await loadScopedBalanceReport(db, scope);
    views.push({ scope, organizationName: organization.name, report });
  }
  return { views, nextCursor: organizations.length > 16 ? page.at(-1)!.id : null };
}
export async function loadOwnerInvestmentViews(db: PrismaClient, userId: string) {
  return (await loadOwnerInvestmentPage(db, userId)).views;
}

/** Bounded planning read. Never synthesizes tokens for candidates that have not run. */
export async function loadInvestmentStartPreferences(db: FundingReadDb & Pick<Prisma.TransactionClient, "$queryRaw">, itemIds: readonly string[]) {
  const preferences: NonNullable<import("../demand/start-ranking").StartRankingContext["investmentByItem"]> = {};
  const installationRef = await readInvestmentInstallationId(db);
  if (!installationRef) return preferences;
  const now = new Date();
  const evaluated = new Map<string, Awaited<ReturnType<typeof evaluateInvestmentBalance>>>();
  // Reads are sequential and each inheritance traversal is bounded. No storage-order truncation.
  for (const itemId of new Set(itemIds)) {
    const resolved = await loadItemBalancePolicy(db, { itemId }, now);
    if (!resolved.ok) continue;
    const { scope, policy, revision } = resolved.data;
    const scopeKey = policyScopeKey(scope);
    if (!policy.steeringEnabled) { preferences[itemId] = { scopeKey, preferred: null }; continue; }
    const key = `${scopeKey}:${revision?.revision ?? "default"}`;
    let balance = evaluated.get(key);
    if (!balance) {
      const observed = await loadInvestmentObservation(db, { scope, installationRef, windowDays: policy.windowDays, now });
      balance = evaluateInvestmentBalance(policy, observed, now);
      evaluated.set(key, balance);
    }
    preferences[itemId] = { scopeKey, preferred: balance.preferred, ...(resolved.data.classification ? { classification: resolved.data.classification.value } : {}) };
  }
  return preferences;
}

/** Called once immediately before adapter dispatch; both outcome paths reuse this snapshot. */
export async function loadBuildInvestmentContext(db: FundingReadDb & Pick<Prisma.TransactionClient, "featureBuild">, buildRef: string): Promise<{ snapshot: InvestmentAttemptSnapshot | null; guidance: string }> {
  const unresolved = { snapshot: null, guidance: UNRESOLVED_INVESTMENT_GUIDANCE };
  const build = await db.featureBuild.findFirst({ where: { OR: [{ id: buildRef }, { buildId: buildRef }] }, select: { originatingBacklogItemId: true } });
  if (!build?.originatingBacklogItemId) return unresolved;
  const item = await db.backlogItem.findFirst({ where: { OR: [{ id: build.originatingBacklogItemId }, { itemId: build.originatingBacklogItemId }] }, select: { id: true, itemId: true, workType: true } });
  if (!item) return unresolved;
  const now = new Date();
  const resolved = await loadItemBalancePolicy(db, { itemId: item.itemId }, now);
  if (!resolved.ok) return unresolved;
  const installationRef = await readInvestmentInstallationId(db);
  if (!installationRef) return unresolved;
  const value = resolved.data;
  return {
    guidance: formatInvestmentGuidance(value),
    snapshot: {
      investmentPrincipalId: value.scope.principalId, investmentOrganizationId: value.scope.organizationId,
      investmentItemId: item.id, investmentPurpose: value.scope.purpose === "shared-platform" ? "sharedPlatform" : "archetype",
      investmentClass: value.classification?.value ?? classifyInvestment(item.workType), investmentInstallationRef: installationRef,
      investmentPolicyRef: JSON.stringify({ policy: value.revision ? `${policyScopeKey(value.scope)}:revision:${value.revision.revision}` : "development-investment.default.v1", classification: value.classification?.reference ?? null }),
      investmentCapturedAt: now,
    },
  };
}
