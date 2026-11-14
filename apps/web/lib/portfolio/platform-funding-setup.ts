import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { WWMD_PLATFORM_PROFILE_ID } from "@/lib/decision/caller-context";
import { isPlatformAutomationPersona } from "@/lib/govern/automation-persona-identity";
import { currentUserContextFromRecord } from "@/lib/govern/current-user-context";
import { resolveActiveHumanPrincipalRecordIdForUser } from "@/lib/identity/principal-linking";
import { humanApprovalForExecution } from "@/lib/coworker/human-approved-execution";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { can } from "@/lib/permissions";
import { isRecord } from "@/lib/shared/coerce";
import { ok, type ActionResult } from "@/lib/shared/action-result";
import { defaultBalancePolicy, type BalancePolicy } from "./investment-balance";
import { policyRevisionIsActive, readStoredCurrentPolicy, type PolicyRevision } from "./investment-balance-policy";
import { readInvestmentInstallationId } from "./investment-balance-server";

type ReadDb = Pick<Prisma.TransactionClient, "user" | "principal" | "organization" | "decisionPerspectiveProfile" | "platformConfig">;
type Actor = { userId: string; principalId: string; displayName: string };
export type PlatformFundingAllocation = { source: "default" | "explicit"; policy: BalancePolicy; revision: PolicyRevision | null; active: boolean };
export type PlatformFundingSetupOrganization = { id: string; name: string; expectedDigest: string; allocation: PlatformFundingAllocation };
export type PlatformFundingSetupProfile = { profileId: string; name: string; currentVersionId: string | null; ownerPrincipalId: string | null; ownerOrganizationId: string | null };
export type PlatformFundingSetupView = {
  status: "available" | "already-recorded" | "partial-or-conflicting" | "unavailable";
  reason: string | null;
  installationId: string | null;
  person: { principalId: string; displayName: string } | null;
  profile: PlatformFundingSetupProfile | null;
  organizations: PlatformFundingSetupOrganization[];
  nextCursor: string | null;
};
export type PlatformFundingOwnerConfirmation = {
  status: "confirmed" | "already-recorded";
  installationId: string;
  profileId: string;
  principalId: string;
  organizationId: string;
  auditKey: string;
  confirmedAt: string;
};
type ConfirmationInput = { userId: string; params: Record<string, unknown>; context?: ToolExecutionContext };
type ConfirmationParams = { organizationId: string; expectedDigest: string; attestation: true; reason: string };
const profileSelect = {
  id: true, profileId: true, name: true, kind: true, status: true, ownerPrincipalId: true, ownerOrganizationId: true,
  currentVersionId: true, updatedAt: true,
  currentVersion: { select: { versionId: true, profileId: true, materialFingerprint: true, promotedByPrincipalId: true } },
} as const;
type Profile = Prisma.DecisionPerspectiveProfileGetPayload<{ select: typeof profileSelect }>;
const organizationSelect = { id: true, name: true, topAccountablePrincipalId: true, updatedAt: true } as const;
type Organization = Prisma.OrganizationGetPayload<{ select: typeof organizationSelect }>;
const fail = (error: string): ActionResult<never> => ({ ok: false, error });
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const PAGE_SIZE = 10;

async function currentHuman(db: ReadDb, userId: string): Promise<Actor | null> {
  if (!userId.trim()) return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: {
    email: true, isActive: true, isSuperuser: true, automationVerificationId: true, automationProfile: true,
    automationSlot: true, automationExpiresAt: true, groups: { include: { platformRole: true } },
  } });
  const authority = currentUserContextFromRecord(userId, user);
  if (!authority || !can(authority, "manage_platform") || !user?.email?.trim()
    || isPlatformAutomationPersona(user.email) || user.automationVerificationId != null || user.automationProfile != null
    || user.automationSlot != null || user.automationExpiresAt != null) return null;
  const principalId = await resolveActiveHumanPrincipalRecordIdForUser(userId, db);
  if (!principalId) return null;
  const principal = await db.principal.findUnique({ where: { id: principalId }, select: { id: true, kind: true, status: true, displayName: true } });
  return principal?.kind === "human" && principal.status === "active"
    ? { userId, principalId: principal.id, displayName: principal.displayName } : null;
}

function profileView(profile: Profile): PlatformFundingSetupProfile {
  return { profileId: profile.profileId, name: profile.name, currentVersionId: profile.currentVersionId,
    ownerPrincipalId: profile.ownerPrincipalId, ownerOrganizationId: profile.ownerOrganizationId };
}
function usableProfile(profile: Profile | null): profile is Profile {
  return !!profile && profile.profileId === WWMD_PLATFORM_PROFILE_ID && profile.kind === "platform" && profile.status === "active"
    && !!profile.currentVersionId && profile.currentVersion !== null && profile.currentVersion.versionId === profile.currentVersionId
    && profile.currentVersion.profileId === profile.profileId;
}
function ownershipState(profile: Profile) {
  return { ...profileView(profile), id: profile.id, kind: profile.kind, status: profile.status,
    updatedAt: profile.updatedAt.toISOString(), version: profile.currentVersion };
}
function organizationState(organization: Organization) {
  return { ...organization, updatedAt: organization.updatedAt.toISOString() };
}
function stateDigest(installationId: string, actor: Actor, profile: Profile, organization: Organization, allocation: PlatformFundingAllocation) {
  return hash({ version: 1, installationId, actor, profile: ownershipState(profile), organization: organizationState(organization), allocation });
}
async function prospectiveAllocation(db: ReadDb, actor: Actor, organizationId: string, now: Date): Promise<ActionResult<PlatformFundingAllocation>> {
  const revision = await readStoredCurrentPolicy(db, { principalId: actor.principalId, organizationId, purpose: "shared-platform" });
  if (!revision.ok) return fail("funding-setup-unavailable");
  return ok({ source: revision.data ? "explicit" : "default", policy: revision.data?.policy ?? defaultBalancePolicy("founder", "shared-platform"),
    revision: revision.data, active: revision.data === null || policyRevisionIsActive(revision.data, now) });
}

/** Read-only prospective ownership. No administrator, account name or installer is promoted into an owner. */
export async function readPlatformFundingSetup(db: PrismaClient, input: { userId: string; afterOrganizationId?: string | null }): Promise<ActionResult<PlatformFundingSetupView>> {
  if (input.afterOrganizationId != null && (!input.afterOrganizationId.trim() || input.afterOrganizationId.length > 200)) return fail("funding-setup-invalid-input");
  try {
    return await db.$transaction(async tx => {
      const actor = await currentHuman(tx, input.userId);
      if (!actor) return fail("funding-setup-not-authorized");
      const [installationId, profile] = await Promise.all([
        readInvestmentInstallationId(tx), tx.decisionPerspectiveProfile.findUnique({ where: { profileId: WWMD_PLATFORM_PROFILE_ID }, select: profileSelect }),
      ]);
      const view: PlatformFundingSetupView = { status: "unavailable", reason: null, installationId,
        person: { principalId: actor.principalId, displayName: actor.displayName }, profile: profile ? profileView(profile) : null,
        organizations: [], nextCursor: null };
      if (!installationId || !usableProfile(profile)) return ok<PlatformFundingSetupView>({ ...view, reason: !installationId ? "installation-unavailable" : "profile-unavailable" });
      if (profile.ownerPrincipalId !== null || profile.ownerOrganizationId !== null) {
        return ok<PlatformFundingSetupView>({ ...view, status: profile.ownerPrincipalId !== null && profile.ownerOrganizationId !== null ? "already-recorded" : "partial-or-conflicting" });
      }
      const organizations = await tx.organization.findMany({ where: { topAccountablePrincipalId: actor.principalId,
        ...(input.afterOrganizationId ? { id: { gt: input.afterOrganizationId } } : {}) }, select: organizationSelect, orderBy: { id: "asc" }, take: PAGE_SIZE + 1 });
      const page = organizations.slice(0, PAGE_SIZE);
      const now = new Date();
      for (const organization of page) {
        const allocation = await prospectiveAllocation(tx, actor, organization.id, now);
        if (!allocation.ok) return ok<PlatformFundingSetupView>({ ...view, reason: "allocation-unavailable" });
        view.organizations.push({ id: organization.id, name: organization.name, allocation: allocation.data,
          expectedDigest: stateDigest(installationId, actor, profile, organization, allocation.data) });
      }
      return ok<PlatformFundingSetupView>({ ...view, status: "available", reason: page.length === 0 ? "no-owned-organizations" : null,
        nextCursor: organizations.length > PAGE_SIZE ? page.at(-1)!.id : null });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isRecord(error) && error.code === "P2034") return fail("funding-setup-unavailable");
    throw error;
  }
}

function confirmationParams(params: Record<string, unknown>): params is ConfirmationParams {
  return Object.keys(params).length === 4 && Object.keys(params).every(key => ["organizationId", "expectedDigest", "attestation", "reason"].includes(key))
    && typeof params.organizationId === "string" && !!params.organizationId.trim() && params.organizationId === params.organizationId.trim() && params.organizationId.length <= 200
    && typeof params.expectedDigest === "string" && /^[a-f0-9]{64}$/.test(params.expectedDigest)
    && params.attestation === true && typeof params.reason === "string" && !!params.reason.trim() && params.reason.length <= 2000;
}
async function humanDecision(input: ConfirmationInput): Promise<{ envelopeId: string | null } | null> {
  if (input.context?.agentId) {
    const approval = await humanApprovalForExecution({ envelopeId: input.context.approvedAuthorityEnvelopeId,
      toolName: "confirm_platform_funding_owner", userId: input.userId, agentId: input.context.agentId,
      params: input.params, requiredApproverCapability: "manage_platform" });
    // The generic verifier can admit administrator decisions on behalf of another
    // person. Initial platform ownership specifically requires the owner themselves.
    return approval?.approverUserId === input.userId && approval.onBehalfOf === null ? { envelopeId: approval.envelopeId } : null;
  }
  return input.context?.governedSource === "rest" && !input.context.apiTokenId && !input.context.authSource
    ? { envelopeId: null } : null;
}
class StaleSetup extends Error {}

/** Shared portal/MCP authority writer. It neither ratifies policy nor applies a funding binding. */
export async function confirmPlatformFundingOwner(db: PrismaClient, input: ConfirmationInput): Promise<ActionResult<PlatformFundingOwnerConfirmation>> {
  if (!confirmationParams(input.params)) return fail("funding-setup-invalid-input");
  const params = input.params;
  const approval = await humanDecision(input);
  if (!approval) return fail("funding-setup-human-required");
  try {
    return await db.$transaction(async tx => {
      const actor = await currentHuman(tx, input.userId);
      if (!actor) return fail("funding-setup-not-authorized");
      const [installationId, profile, organization] = await Promise.all([
        readInvestmentInstallationId(tx), tx.decisionPerspectiveProfile.findUnique({ where: { profileId: WWMD_PLATFORM_PROFILE_ID }, select: profileSelect }),
        tx.organization.findUnique({ where: { id: params.organizationId }, select: organizationSelect }),
      ]);
      if (!installationId || !usableProfile(profile)) return fail("funding-setup-unavailable");
      if (!organization || organization.topAccountablePrincipalId !== actor.principalId) return fail("funding-setup-not-authorized");
      const allocation = await prospectiveAllocation(tx, actor, organization.id, new Date());
      if (!allocation.ok) return allocation;
      const auditKey = `platform-funding-setup.v1:audit:${JSON.stringify([installationId, profile.profileId, params.expectedDigest])}`;
      const existing = await tx.platformConfig.findUnique({ where: { key: auditKey } });
      if (existing) {
        const audit = existing.value;
        if (isRecord(audit) && audit.version === 1 && audit.installationId === installationId && audit.profileId === profile.profileId
          && audit.actorUserId === actor.userId && audit.principalId === actor.principalId && audit.organizationId === organization.id
          && audit.expectedDigest === params.expectedDigest && audit.inputDigest === hash(params)
          && audit.attestation === true && audit.reason === params.reason.trim()
          && isRecord(audit.beforeState) && audit.beforeState.ownerPrincipalId === null && audit.beforeState.ownerOrganizationId === null
          && isRecord(audit.afterState) && hash(audit.afterState) === hash(ownershipState(profile))
          && isRecord(audit.organization) && hash(audit.organization) === hash(organizationState(organization))
          && isRecord(audit.allocation) && hash(audit.allocation) === hash(allocation.data)
          && hash({ version: 1, installationId, actor, profile: audit.beforeState, organization: audit.organization, allocation: audit.allocation }) === params.expectedDigest
          && typeof audit.confirmedAt === "string" && Number.isFinite(Date.parse(audit.confirmedAt)) && Date.parse(audit.confirmedAt) <= Date.now()
          && profile.ownerPrincipalId === actor.principalId && profile.ownerOrganizationId === organization.id
          && audit.afterStateDigest === stateDigest(installationId, actor, profile, organization, allocation.data)) {
          return ok<PlatformFundingOwnerConfirmation>({ status: "already-recorded", installationId, profileId: profile.profileId, principalId: actor.principalId,
            organizationId: organization.id, auditKey, confirmedAt: audit.confirmedAt });
        }
        return fail("funding-setup-conflict");
      }
      if (profile.ownerPrincipalId !== null || profile.ownerOrganizationId !== null) return fail("funding-setup-owner-recorded");
      if (stateDigest(installationId, actor, profile, organization, allocation.data) !== params.expectedDigest) return fail("funding-setup-stale");
      // Revalidate the persisted human decision immediately before its authority
      // consequence; an expired or revoked decision cannot live on in an earlier read.
      if (!await humanDecision(input)) return fail("funding-setup-human-required");
      const changed = await tx.decisionPerspectiveProfile.updateMany({ where: { id: profile.id, profileId: profile.profileId,
        kind: profile.kind, status: profile.status, currentVersionId: profile.currentVersionId, updatedAt: profile.updatedAt,
        ownerPrincipalId: null, ownerOrganizationId: null }, data: { ownerPrincipalId: actor.principalId, ownerOrganizationId: organization.id } });
      if (changed.count !== 1) throw new StaleSetup();
      const after = await tx.decisionPerspectiveProfile.findUnique({ where: { profileId: profile.profileId }, select: profileSelect });
      if (!usableProfile(after) || after.ownerPrincipalId !== actor.principalId || after.ownerOrganizationId !== organization.id) throw new StaleSetup();
      const confirmedAt = new Date().toISOString();
      await tx.platformConfig.create({ data: { key: auditKey, value: {
        version: 1, installationId, profileId: profile.profileId, actorUserId: actor.userId, principalId: actor.principalId,
        organizationId: organization.id, expectedDigest: params.expectedDigest, inputDigest: hash(params), attestation: true,
        reason: params.reason.trim(), approvedAuthorityEnvelopeId: approval.envelopeId, confirmedAt,
        beforeState: ownershipState(profile), afterState: ownershipState(after), organization: organizationState(organization), allocation: allocation.data,
        afterStateDigest: stateDigest(installationId, actor, after, organization, allocation.data),
      } as Prisma.InputJsonValue } });
      return ok<PlatformFundingOwnerConfirmation>({ status: "confirmed", installationId, profileId: profile.profileId, principalId: actor.principalId,
        organizationId: organization.id, auditKey, confirmedAt });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof StaleSetup || (isRecord(error) && (error.code === "P2002" || error.code === "P2034"))) return fail("funding-setup-stale");
    throw error;
  }
}
