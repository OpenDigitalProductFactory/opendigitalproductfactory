// BI-A8399604 — governed creation and one-time retrieval for the two
// organization-join host actions. This is DB-injected so every authorization,
// encryption, and replay rule is unit-testable without a live runtime.

import { createHash, randomUUID } from "node:crypto";

import {
  parseOrganizationJoinPackage,
  parseOrganizationJoinRequest,
  requiredOrganizationTrustRole,
  type OrganizationJoinActionType,
} from "@dpf/db/organization-join-action";

import { decryptSecret as decryptStoredSecret, encryptSecret as encryptStoredSecret } from "@/lib/govern/credential-crypto";
import { isRecord } from "@/lib/shared/coerce";

interface EdgeNodeActionView {
  id: string;
  nodeId: string;
  trustState: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  metadata: unknown;
  scopePolicy: unknown;
  capabilityRows: Array<{ capability: string; mode: string; evidence: unknown }>;
}

interface ChangeRequestActionView {
  id: string;
  status: string;
  approvedAt: Date | null;
  approvedById: string | null;
  impactReport: unknown;
  postChangeVerification: unknown;
  changeItems: Array<{ rollbackPlan: string | null }>;
}

interface IssuedPackageActionView {
  actionKey: string;
  actionType: string;
  status: string;
  result: unknown;
}

export interface OrganizationJoinActionDb {
  edgeNode: {
    findUnique(args: unknown): Promise<EdgeNodeActionView | null>;
  };
  changeRequest: {
    findUnique(args: unknown): Promise<ChangeRequestActionView | null>;
  };
  remoteAction: {
    create(args: { data: Record<string, unknown> }): Promise<{ actionKey: string }>;
    findFirst(args: unknown): Promise<{ actionKey: string } | null>;
    findUnique(args: unknown): Promise<IssuedPackageActionView | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export interface CreateOrganizationJoinActionInput {
  actionType: OrganizationJoinActionType;
  edgeNodeId: string;
  changeRequestId: string;
  requestedByPrincipalId: string;
  operatorConfirmed: boolean;
  parameters: unknown;
}

export type CreateOrganizationJoinActionResult =
  | { ok: true; actionKey: string }
  | { ok: false; reason: string };

interface CreateOptions {
  now?: Date;
  actionKeyFactory?: () => string;
  encryptSecret?: (value: string) => string;
}

export async function createOrganizationJoinAction(
  db: OrganizationJoinActionDb,
  input: CreateOrganizationJoinActionInput,
  options: CreateOptions = {},
): Promise<CreateOrganizationJoinActionResult> {
  const now = options.now ?? new Date();
  if (!input.operatorConfirmed) return { ok: false, reason: "operator-confirmation-required" };
  if (!input.requestedByPrincipalId.trim()) return { ok: false, reason: "requesting-principal-required" };
  const parsed = parseOrganizationJoinRequest(input.actionType, input.parameters, now);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const [node, change] = await Promise.all([
    db.edgeNode.findUnique({
      where: { id: input.edgeNodeId },
      select: {
        id: true, nodeId: true, trustState: true, customerAccountId: true, customerSiteId: true,
        metadata: true, scopePolicy: true,
        capabilityRows: { where: { capability: "action.execute" }, select: { capability: true, mode: true, evidence: true } },
      },
    }),
    db.changeRequest.findUnique({
      where: { id: input.changeRequestId },
      select: {
        id: true, status: true, approvedAt: true, approvedById: true,
        impactReport: true, postChangeVerification: true,
        changeItems: { select: { rollbackPlan: true } },
      },
    }),
  ]);
  if (!node || node.trustState !== "trusted") return { ok: false, reason: "trusted-edge-node-required" };
  const capability = node.capabilityRows.find((row) => row.capability === "action.execute" && row.mode === "enabled");
  if (!capability) return { ok: false, reason: "action-execute-capability-required" };
  const role = organizationTrustRoleFromEvidence(capability.evidence);
  if (role !== requiredOrganizationTrustRole(input.actionType)) return { ok: false, reason: "wrong-host-role" };
  if (!allowedActionTypes(node.scopePolicy).includes(input.actionType)) return { ok: false, reason: "action-not-allowlisted" };
  const changeGate = validateChangeRequest(change, node.id, input.actionType);
  if (changeGate) return { ok: false, reason: changeGate };

  let storedParameters: Record<string, unknown>;
  let packageEvidence: Record<string, unknown> = {};
  let packageDigest: string | null = null;
  if (input.actionType === "organization.join.import") {
    const joinPackage = (parsed.value as { joinPackage: string }).joinPackage;
    const packagePreview = parseOrganizationJoinPackage(joinPackage, now);
    if (!packagePreview.ok) return { ok: false, reason: packagePreview.reason };
    const expectedPeer = hostIdentity(node.metadata);
    if (!expectedPeer || packagePreview.value.intendedPeer !== expectedPeer) {
      return { ok: false, reason: "join-package-intended-for-another-host" };
    }
    packageDigest = createHash("sha256").update(joinPackage, "utf8").digest("hex");
    const existing = await db.remoteAction.findFirst({
      where: {
        actionType: "organization.join.import",
        evidence: { path: ["packageDigest"], equals: packageDigest },
      },
      select: { actionKey: true },
    });
    if (existing) return { ok: false, reason: "join-package-already-used" };
    const encrypted = (options.encryptSecret ?? encryptStoredSecret)(joinPackage);
    if (!encrypted.startsWith("enc:")) return { ok: false, reason: "credential-encryption-unavailable" };
    storedParameters = { joinPackageEnc: encrypted };
    packageEvidence = {
      packageDigest,
      packageId: packagePreview.value.packageId,
      intendedPeer: packagePreview.value.intendedPeer,
      expiresAt: packagePreview.value.expiresAt.toISOString(),
      rootFingerprintPrefix: packagePreview.value.rootFingerprint.slice(0, 12),
    };
  } else {
    const issue = parsed.value as { intendedPeer: string; ttlSeconds: number };
    storedParameters = issue;
    packageEvidence = { intendedPeer: issue.intendedPeer, ttlSeconds: issue.ttlSeconds };
  }

  const actionKey = options.actionKeyFactory
    ? options.actionKeyFactory()
    : packageDigest
      ? `ra_join_import_${packageDigest}`
      : defaultActionKey();
  try {
    const created = await db.remoteAction.create({
      data: {
      actionKey,
      actionType: input.actionType,
      edgeNodeId: node.id,
      customerAccountId: node.customerAccountId,
      customerSiteId: node.customerSiteId,
      parameters: storedParameters,
      riskClass: "high",
      requestedByPrincipalId: input.requestedByPrincipalId,
      approvalState: "approved",
      approvedByPrincipalId: input.requestedByPrincipalId,
      changeRequestId: change!.id,
      status: "queued",
      evidence: {
        governance: "operator-confirmed-approved-change-request",
        operatorConfirmedAt: now.toISOString(),
        organizationTrustRole: role,
        recoveryDeclared: true,
        postChangeVerificationDeclared: true,
        ...packageEvidence,
      },
      },
    });
    return { ok: true, actionKey: created.actionKey };
  } catch (error) {
    if (packageDigest && isUniqueConstraintError(error)) {
      return { ok: false, reason: "join-package-already-used" };
    }
    throw error;
  }
}

function defaultActionKey(): string {
  return `ra_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function organizationTrustRoleFromEvidence(value: unknown): "authority" | "member" | null {
  if (!isRecord(value)) return null;
  return value.organizationTrustRole === "authority" || value.organizationTrustRole === "member"
    ? value.organizationTrustRole
    : null;
}

function allowedActionTypes(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.actionTypes)) return [];
  return value.actionTypes.filter((item): item is string => typeof item === "string");
}

function hostIdentity(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.hostname === "string") return value.hostname;
  if (isRecord(value.host) && typeof value.host.hostname === "string") return value.host.hostname;
  return null;
}

function validateChangeRequest(
  change: ChangeRequestActionView | null,
  edgeNodeId: string,
  actionType: OrganizationJoinActionType,
): string | null {
  if (!change || change.status !== "approved" || !change.approvedAt || !change.approvedById) {
    return "approved-change-request-required";
  }
  if (!isNonEmptyRecord(change.impactReport) ||
      change.impactReport.edgeNodeId !== edgeNodeId ||
      change.impactReport.actionType !== actionType ||
      change.impactReport.operatorConfirmation !== true) {
    return "impact-report-required";
  }
  if (!change.changeItems.length || change.changeItems.some((item) => !item.rollbackPlan?.trim())) {
    return "recovery-plan-required";
  }
  const verification = change.postChangeVerification;
  if (!isNonEmptyRecord(verification)) return "post-change-verification-required";
  const required = ["certificateTrust", "overlayPersistence", "portalHealth", "edgeHeartbeat"];
  if (required.some((key) => verification[key] !== true)) return "post-change-verification-required";
  return null;
}

function isUniqueConstraintError(value: unknown): boolean {
  return isRecord(value) && value.code === "P2002";
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

export type ConsumeIssuedJoinPackageResult =
  | { ok: true; joinPackage: string; expiresAt: Date }
  | { ok: false; reason: string };

export async function consumeIssuedJoinPackage(
  db: OrganizationJoinActionDb,
  actionKey: string,
  options: { now?: Date; decryptSecret?: (value: string) => string | null } = {},
): Promise<ConsumeIssuedJoinPackageResult> {
  const now = options.now ?? new Date();
  const row = await db.remoteAction.findUnique({
    where: { actionKey },
    select: { actionKey: true, actionType: true, status: true, result: true },
  });
  if (!row || row.actionType !== "organization.join.issue" || row.status !== "succeeded" || !isRecord(row.result)) {
    return { ok: false, reason: "join-package-not-available" };
  }
  if (typeof row.result.downloadedAt === "string" || typeof row.result.joinPackageEnc !== "string") {
    return { ok: false, reason: "join-package-consumed" };
  }
  if (typeof row.result.expiresAt !== "string") return { ok: false, reason: "join-package-not-available" };
  const expiresAt = new Date(row.result.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    await db.remoteAction.updateMany({
      where: { actionKey, status: "succeeded" },
      data: { result: { expiresAt: row.result.expiresAt, expiredAt: now.toISOString() } },
    });
    return { ok: false, reason: "join-package-expired" };
  }
  const decrypted = (options.decryptSecret ?? decryptStoredSecret)(row.result.joinPackageEnc);
  if (!decrypted) return { ok: false, reason: "join-package-decryption-failed" };
  const updated = await db.remoteAction.updateMany({
    where: {
      actionKey,
      status: "succeeded",
      result: { path: ["joinPackageEnc"], equals: row.result.joinPackageEnc },
    },
    data: { result: { expiresAt: row.result.expiresAt, downloadedAt: now.toISOString() } },
  });
  if (updated.count !== 1) return { ok: false, reason: "join-package-consumed" };
  return { ok: true, joinPackage: decrypted, expiresAt };
}

export async function cancelQueuedOrganizationJoinAction(
  db: OrganizationJoinActionDb,
  actionKey: string,
  options: { now?: Date } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const now = options.now ?? new Date();
  const row = await db.remoteAction.findUnique({
    where: { actionKey },
    select: { actionKey: true, actionType: true, status: true, result: true },
  });
  if (!row || (row.actionType !== "organization.join.issue" && row.actionType !== "organization.join.import")) {
    return { ok: false, reason: "action-not-found" };
  }
  if (row.status !== "queued") return { ok: false, reason: "action-already-dispatched" };
  const updated = await db.remoteAction.updateMany({
    where: { actionKey, status: "queued" },
    data: {
      status: "failed",
      approvalState: "cancelled",
      parameters: { clearedAt: now.toISOString() },
      result: {},
      completedAt: now,
      evidence: { cancellationReason: "operator-cancelled-before-dispatch", cancelledAt: now.toISOString() },
    },
  });
  return updated.count === 1 ? { ok: true } : { ok: false, reason: "action-already-dispatched" };
}
