"use server";

// BI-A8399604 — session-gated portal boundary for the two governed host
// actions. The Connections UI calls these actions; no browser code executes a
// host command and no generic command/action surface exists.

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import {
  isOrganizationJoinActionType,
  type OrganizationJoinActionType,
} from "@dpf/db/organization-join-action";

import { auth } from "@/lib/auth";
import { importOrganizationJoinFile } from "@/lib/federation/organization-join-import";
import { issueOrganizationJoinFile } from "@/lib/federation/organization-join-issue";
import { resolveLocalFederationAuthorityUrl } from "@/lib/federation/self-authority";
import { makeRfcId } from "@/lib/change-management/lifecycle";
import { assertEncryptionReadyForCredentialWrite } from "@/lib/govern/credential-crypto";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { can } from "@/lib/permissions";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import { isRecord } from "@/lib/shared/coerce";
import {
  cancelQueuedOrganizationJoinAction,
  consumeIssuedJoinPackage,
  createOrganizationJoinAction,
  type OrganizationJoinActionDb,
} from "@/lib/remote-action/organization-join-actions";
import { sanitizeActionEvidence } from "@/lib/remote-action/dispatch-orchestrator";

const CONNECTIONS_PATH = "/platform/federation-links";

class OrganizationJoinRequestError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

type OrganizationJoinActionFailure = {
  ok: false;
  error: "unauthorized" | "forbidden" | "invalid_input" | "not_ready" | "conflict" | "internal_error";
  message: string;
};

async function assertManagePlatform(): Promise<
  | { ok: true; userId: string; principalId: string; employeeProfileId: string }
  | OrganizationJoinActionFailure
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "unauthorized", message: "Sign in required" };
  if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")) {
    return { ok: false, error: "forbidden", message: "Platform management access is required" };
  }
  const [alias, employee] = await Promise.all([
    prisma.principalAlias.findFirst({
      where: { aliasType: "user", aliasValue: session.user.id },
      select: { principalId: true },
    }),
    prisma.employeeProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } }),
  ]);
  if (!employee) {
    return { ok: false, error: "not_ready", message: "Your operator profile is not linked to change management" };
  }
  const principalId = alias?.principalId ?? (await syncUserPrincipal(session.user.id)).id;
  return { ok: true, userId: session.user.id, principalId, employeeProfileId: employee.id };
}

export interface OrganizationJoinNodeSummary {
  edgeNodeId: string;
  nodeId: string;
  displayName: string;
  platform: string;
  status: string;
  trustState: string;
  role: "authority" | "member" | null;
  actionType: OrganizationJoinActionType | null;
  hostIdentity: string | null;
  ready: boolean;
  readinessMessage: string;
  latestAction: {
    actionKey: string;
    actionType: OrganizationJoinActionType;
    status: string;
    approvalState: string;
    packageReady: boolean;
    evidence: Record<string, unknown>;
    createdAt: string;
  } | null;
}

export async function getOrganizationJoinNodeSummariesAction(): Promise<
  { ok: true; nodes: OrganizationJoinNodeSummary[] } | OrganizationJoinActionFailure
> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const rows = await prisma.edgeNode.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, nodeId: true, platform: true, status: true, trustState: true,
      metadata: true, scopePolicy: true,
      principal: { select: { displayName: true } },
      capabilityRows: {
        where: { capability: "action.execute" },
        select: { mode: true, status: true, evidence: true },
      },
    },
  });
  const actions = rows.length === 0
    ? []
    : await prisma.remoteAction.findMany({
        where: {
          edgeNodeId: { in: rows.map((row) => row.id) },
          actionType: { in: ["organization.join.issue", "organization.join.import"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          actionKey: true,
          actionType: true,
          edgeNodeId: true,
          status: true,
          approvalState: true,
          result: true,
          evidence: true,
          createdAt: true,
        },
      });
  const latestByNode = new Map<string, (typeof actions)[number]>();
  for (const action of actions) {
    if (action.edgeNodeId && !latestByNode.has(action.edgeNodeId)) latestByNode.set(action.edgeNodeId, action);
  }
  return {
    ok: true,
    nodes: rows.map((row) => {
      const capability = row.capabilityRows[0];
      const evidence = isRecord(capability?.evidence) ? capability.evidence : {};
      const role = evidence.organizationTrustRole === "authority" || evidence.organizationTrustRole === "member"
        ? evidence.organizationTrustRole
        : null;
      const actionType = role === "authority"
        ? "organization.join.issue"
        : role === "member" ? "organization.join.import" : null;
      const configured = isRecord(row.scopePolicy) && Array.isArray(row.scopePolicy.actionTypes)
        ? row.scopePolicy.actionTypes.includes(actionType)
        : false;
      const ready = row.trustState === "trusted" && capability?.mode === "enabled" && actionType !== null && configured;
      const latest = latestByNode.get(row.id);
      return {
        edgeNodeId: row.id,
        nodeId: row.nodeId,
        displayName: row.principal.displayName,
        platform: row.platform,
        status: row.status,
        trustState: row.trustState,
        role,
        actionType,
        hostIdentity: edgeHostIdentity(row.metadata),
        ready,
        readinessMessage: ready
          ? "Secure host action channel ready"
          : row.trustState !== "trusted"
            ? "Trust this installation before organization setup"
            : capability?.mode !== "enabled"
              ? "Enable secure host actions for this installation"
              : !role
                ? "The installation has not reported its organization role"
                : "Allow the organization setup action for this installation",
        latestAction: latest && isOrganizationJoinActionType(latest.actionType)
          ? {
              actionKey: latest.actionKey,
              actionType: latest.actionType,
              status: latest.status,
              approvalState: latest.approvalState,
              packageReady: isRecord(latest.result) && typeof latest.result.joinPackageEnc === "string",
              evidence: sanitizeActionEvidence(isRecord(latest.evidence) ? latest.evidence : undefined),
              createdAt: latest.createdAt.toISOString(),
            }
          : null,
      };
    }),
  };
}

export async function authorizeOrganizationJoinNodeAction(input: {
  edgeNodeId: string;
  actionType: OrganizationJoinActionType;
  operatorConfirmed: boolean;
}): Promise<{ ok: true } | OrganizationJoinActionFailure> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (!input.operatorConfirmed) {
    return {
      ok: false,
      error: "invalid_input",
      message: "Confirm this installation before enabling secure organization setup",
    };
  }
  const node = await prisma.edgeNode.findUnique({
    where: { id: input.edgeNodeId },
    select: {
      id: true,
      trustState: true,
      scopePolicy: true,
      capabilityRows: {
        where: { capability: "action.execute" },
        select: { id: true, mode: true, evidence: true },
      },
    },
  });
  if (!node || node.trustState !== "trusted") {
    return { ok: false, error: "not_ready", message: "Trust this installation before enabling organization setup" };
  }
  const capability = node.capabilityRows[0];
  const evidence = isRecord(capability?.evidence) ? capability.evidence : {};
  const role = evidence.organizationTrustRole === "authority" || evidence.organizationTrustRole === "member"
    ? evidence.organizationTrustRole
    : null;
  const expectedAction = role === "authority"
    ? "organization.join.issue"
    : role === "member" ? "organization.join.import" : null;
  if (!capability || expectedAction !== input.actionType) {
    return {
      ok: false,
      error: "not_ready",
      message: "This installation has not reported the required secure organization role",
    };
  }
  const scopePolicy = isRecord(node.scopePolicy) ? node.scopePolicy : {};
  const existing = Array.isArray(scopePolicy.actionTypes)
    ? scopePolicy.actionTypes.filter((value): value is string => typeof value === "string")
    : [];
  const actionTypes = [...new Set([...existing, input.actionType])];
  await prisma.$transaction([
    prisma.edgeNode.update({
      where: { id: node.id },
      data: { scopePolicy: { ...scopePolicy, actionTypes } },
    }),
    prisma.edgeNodeCapability.update({
      where: { id: capability.id },
      data: { mode: "enabled" },
    }),
  ]);
  revalidatePath(CONNECTIONS_PATH);
  return { ok: true };
}

export async function queueOrganizationJoinActionAction(input: {
  actionType: OrganizationJoinActionType;
  edgeNodeId: string;
  parameters: unknown;
  operatorConfirmed: boolean;
}): Promise<{ ok: true; actionKey: string } | OrganizationJoinActionFailure> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (input.actionType === "organization.join.import") {
    try {
      await assertEncryptionReadyForCredentialWrite();
    } catch {
      return { ok: false, error: "not_ready", message: "Secure credential storage is not configured" };
    }
  }
  const now = new Date();
  const rfcId = makeRfcId();
  const issue = input.actionType === "organization.join.issue";
  const title = issue ? "Create an expiring organization join file" : "Join this installation to an organization";
  try {
    const result = await prisma.$transaction(async (tx) => {
      const change = await tx.changeRequest.create({
        data: {
        rfcId,
        title,
        description: issue
          ? "Issue one intended-peer-bound organization join package through the native Edge host."
          : "Validate and import one intended-peer-bound organization join package through the native Edge host.",
        type: "normal",
        scope: "organization-trust",
        riskLevel: "high",
        status: "approved",
        submittedAt: now,
        assessedAt: now,
        approvedAt: now,
        requestedById: gate.employeeProfileId,
        assessedById: gate.employeeProfileId,
        approvedById: gate.employeeProfileId,
        impactReport: {
          edgeNodeId: input.edgeNodeId,
          actionType: input.actionType,
          impact: issue ? "Creates a short-lived enrollment package" : "Changes local organization trust overlays",
          operatorConfirmation: input.operatorConfirmed,
        },
        postChangeVerification: {
          certificateTrust: true,
          overlayPersistence: true,
          portalHealth: true,
          edgeHeartbeat: true,
        },
        changeItems: {
          create: {
            itemType: "organization-trust",
            title,
            impactDescription: issue
              ? "A single-use package is available briefly to the confirmed operator."
              : "The local certificate trust and persisted runtime overlays change.",
            rollbackPlan: issue
              ? "Cancel the queued action or let the undownloaded package expire."
              : "Restore the pre-action PKI and environment snapshot, then re-verify portal and Edge health.",
          },
        },
        },
        select: { id: true },
      });
      const created = await createOrganizationJoinAction(tx as unknown as OrganizationJoinActionDb, {
        actionType: input.actionType,
        edgeNodeId: input.edgeNodeId,
        changeRequestId: change.id,
        requestedByPrincipalId: gate.principalId,
        operatorConfirmed: input.operatorConfirmed,
        parameters: input.parameters,
      });
      if (!created.ok) throw new OrganizationJoinRequestError(created.reason);
      return created;
    });
    revalidatePath(CONNECTIONS_PATH);
    return result;
  } catch (error) {
    if (error instanceof OrganizationJoinRequestError) return actionFailure(error.reason);
    return { ok: false, error: "internal_error", message: "Organization setup could not be queued" };
  }
}

const JOIN_FILE_MAX_BYTES = 64 * 1024;

/**
 * Portal-mediated join (EP-ZERO-CONFIG-FEDERATION): choosing the join file is
 * the whole act. The portal generates a key, has the organization CA sign it
 * through the authority's portal, keeps the material in the federation state
 * directory, and the next federation tick records the link trusted on both
 * sides. No edge node, no host script, nothing typed.
 */
export interface OrganizationJoinImported {
  authorityUrl: string;
  intendedPeer: string;
  message: string;
}

export async function importOrganizationJoinFileAction(fileText: string): Promise<
  ActionSuccess<OrganizationJoinImported> | OrganizationJoinActionFailure
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "unauthorized", message: "Sign in required" };
  if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")) {
    return { ok: false, error: "forbidden", message: "Platform management access is required" };
  }
  if (typeof fileText !== "string" || !fileText.trim() || Buffer.byteLength(fileText, "utf8") > JOIN_FILE_MAX_BYTES) {
    return { ok: false, error: "invalid_input", message: "This is not a valid DPF organization join file" };
  }
  const requestHost = await resolveLocalFederationAuthorityUrl();
  const result = await importOrganizationJoinFile({ fileText, requestHost });
  if (!result.imported) return joinImportFailure(result.reason, result.detail);
  revalidatePath(CONNECTIONS_PATH);
  return ok({
    authorityUrl: result.authorityUrl,
    intendedPeer: result.intendedPeer,
    message: `Joined the organization at ${new URL(result.authorityUrl).host}. The connection appears here trusted within a few minutes.`,
  });
}

export interface OrganizationJoinFileIssued {
  fileName: string;
  content: string;
  intendedPeer: string;
  expiresAt: string;
}

/**
 * Portal-mediated issue (EP-ZERO-CONFIG-FEDERATION §5.3): the authority portal
 * mints the join file itself — no edge node, no host script. Returned once;
 * the browser downloads it and it expires in 30 minutes.
 */
export async function issueOrganizationJoinFileAction(input: { intendedPeer: string }): Promise<
  ActionSuccess<OrganizationJoinFileIssued> | OrganizationJoinActionFailure
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "unauthorized", message: "Sign in required" };
  if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")) {
    return { ok: false, error: "forbidden", message: "Platform management access is required" };
  }
  const intendedPeer = typeof input?.intendedPeer === "string" ? input.intendedPeer.trim() : "";
  if (!intendedPeer) return { ok: false, error: "invalid_input", message: "Choose the installation the file is for" };
  const requestHost = await resolveLocalFederationAuthorityUrl();
  const result = await issueOrganizationJoinFile({ intendedPeer, requestHost });
  if (!result.issued) return joinIssueFailure(result.reason, result.detail);
  revalidatePath(CONNECTIONS_PATH);
  return ok({ fileName: result.fileName, content: result.packageText, intendedPeer: result.intendedPeer, expiresAt: result.expiresAt });
}

export async function getOrganizationJoinActionStatusAction(actionKey: string): Promise<
  | { ok: true; actionKey: string; actionType: string; status: string; approvalState: string; packageReady: boolean; evidence: Record<string, unknown> }
  | OrganizationJoinActionFailure
> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const row = await prisma.remoteAction.findUnique({
    where: { actionKey },
    select: { actionKey: true, actionType: true, status: true, approvalState: true, result: true, evidence: true },
  });
  if (!row || (row.actionType !== "organization.join.issue" && row.actionType !== "organization.join.import")) {
    return { ok: false, error: "invalid_input", message: "Organization setup action was not found" };
  }
  return {
    ok: true,
    actionKey: row.actionKey,
    actionType: row.actionType,
    status: row.status,
    approvalState: row.approvalState,
    packageReady: isRecord(row.result) && typeof row.result.joinPackageEnc === "string",
    evidence: sanitizeActionEvidence(isRecord(row.evidence) ? row.evidence : undefined),
  };
}

export async function downloadIssuedJoinPackageAction(actionKey: string): Promise<
  { ok: true; fileName: string; content: string; expiresAt: string } | OrganizationJoinActionFailure
> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const result = await consumeIssuedJoinPackage(prisma as unknown as OrganizationJoinActionDb, actionKey);
  if (!result.ok) return actionFailure(result.reason);
  revalidatePath(CONNECTIONS_PATH);
  return {
    ok: true,
    fileName: `organization-join-${actionKey}.dpfjoin`,
    content: result.joinPackage,
    expiresAt: result.expiresAt.toISOString(),
  };
}

export async function cancelOrganizationJoinActionAction(actionKey: string): Promise<
  { ok: true } | OrganizationJoinActionFailure
> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  const result = await cancelQueuedOrganizationJoinAction(prisma as unknown as OrganizationJoinActionDb, actionKey);
  if (!result.ok) return actionFailure(result.reason);
  revalidatePath(CONNECTIONS_PATH);
  return result;
}

function actionFailure(reason: string): OrganizationJoinActionFailure {
  switch (reason) {
    case "operator-confirmation-required":
      return { ok: false, error: "invalid_input", message: "Confirm the local change before continuing" };
    case "wrong-host-role":
      return { ok: false, error: "not_ready", message: "This installation cannot perform that organization setup step" };
    case "action-not-allowlisted":
    case "action-execute-capability-required":
      return { ok: false, error: "not_ready", message: "Secure organization setup is not enabled for this installation" };
    case "join-package-already-used":
    case "action-already-dispatched":
      return { ok: false, error: "conflict", message: "This organization setup request has already been used or started" };
    case "join-package-expired":
      return { ok: false, error: "invalid_input", message: "The join file has expired. Create a new one on the organization installation" };
    case "join-package-intended-for-another-host":
      return { ok: false, error: "invalid_input", message: "The join file was created for another installation" };
    case "join-package-consumed":
      return { ok: false, error: "conflict", message: "The join file has already been downloaded" };
    default:
      return { ok: false, error: "invalid_input", message: "The organization setup request is not valid" };
  }
}
function joinIssueFailure(reason: string, detail?: string): OrganizationJoinActionFailure {
  switch (reason) {
    case "not-the-authority":
      return { ok: false, error: "not_ready", message: "Only the organization installation (the one that holds the organization's certificate authority) can create join files" };
    case "invalid-intended-peer":
      return { ok: false, error: "invalid_input", message: "The installation name is not a valid host name or address" };
    case "own-address-unknown":
      return { ok: false, error: "not_ready", message: "Open this page at the installation's network address (not localhost) so the file can name it" };
    case "ca-unreachable":
    case "provisioner-missing":
    case "provisioner-key-locked":
      return { ok: false, error: "not_ready", message: `The organization's certificate authority could not issue the file${detail ? ` (${detail})` : ""}` };
    default:
      return { ok: false, error: "internal_error", message: "The join file could not be created" };
  }
}

function joinImportFailure(reason: string, detail?: string): OrganizationJoinActionFailure {
  switch (reason) {
    case "join-package-expired":
      return { ok: false, error: "invalid_input", message: "The join file has expired. Create a new one on the organization installation" };
    case "intended-for-another-host":
      return { ok: false, error: "invalid_input", message: "The join file was created for another installation" };
    case "authority-unreachable":
      return { ok: false, error: "not_ready", message: `The organization installation could not be reached${detail ? ` (${detail})` : ""}` };
    case "authority-refused":
      return { ok: false, error: "conflict", message: `The organization installation refused the join file${detail ? ` (${detail})` : ""}. Create a new one and try again` };
    case "chain-untrusted":
      return { ok: false, error: "conflict", message: "The certificate the organization installation returned does not match the join file's trust fingerprint" };
    case "material-not-writable":
      return { ok: false, error: "not_ready", message: `This installation's state directory is not writable${detail ? ` (${detail})` : ""}` };
    default:
      return { ok: false, error: "invalid_input", message: "This is not a valid DPF organization join file" };
  }
}

function edgeHostIdentity(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.hostname === "string") return value.hostname;
  return isRecord(value.host) && typeof value.host.hostname === "string" ? value.host.hostname : null;
}
