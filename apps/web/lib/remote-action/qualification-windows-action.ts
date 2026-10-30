import { createHash } from "node:crypto";

import { QUALIFICATION_WINDOWS_VERIFY_ACTION_TYPE } from "@dpf/db/remote-action-dispatch";

import {
  parseQualificationExperimentState,
  verifyQualificationExperimentAdmission,
  type QualificationExperimentBinding,
} from "@/lib/backlog/initiative-readiness/qualification-research-admission";
import { err, ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { isRecord } from "@/lib/shared/coerce";

export const QUALIFICATION_WINDOWS_PROCEDURE_ID = "windows-handle-replacement-v1";

export type QualificationWindowsNode = {
  id: string; nodeId: string; platform: string; status: string; trustState: string;
  customerAccountId: string | null; customerSiteId: string | null; lastSeenAt: Date | null;
  scopePolicy: unknown;
  capabilityRows: Array<{ capability: string; mode: string; reportedAt: Date; evidence?: unknown }>;
};

export type QualificationWindowsActionPlan = {
  actionKey: string;
  edgeNodeRowId: string;
  parameters: Record<string, unknown>;
  evidence: Record<string, unknown>;
};

type QualificationRefusal = ActionFailure & { reason: string };
type QualificationPlanResult = (ActionSuccess & {
  plan: QualificationWindowsActionPlan;
  binding: QualificationExperimentBinding;
}) | QualificationRefusal;
type QualificationMaterializeResult = (ActionSuccess & { actionKey: string }) | QualificationRefusal;

function refuse(reason: string): QualificationRefusal {
  return { ...err(reason), reason };
}

export type QualificationActionDb = {
  workroom: { findUnique(args: unknown): Promise<any>; update(args: unknown): Promise<any> };
  workroomActivity: { create(args: unknown): Promise<any> };
  edgeNode: { findMany(args: unknown): Promise<QualificationWindowsNode[]> };
  remoteAction: { findUnique(args: unknown): Promise<any>; create(args: unknown): Promise<any> };
  changeRequest: { create(args: unknown): Promise<any> };
};

function actionTypes(value: unknown): string[] {
  return isRecord(value) && Array.isArray(value.actionTypes)
    ? value.actionTypes.filter((item): item is string => typeof item === "string") : [];
}

function eligible(node: QualificationWindowsNode, now: Date): boolean {
  const capability = node.capabilityRows.find((row) => row.capability === "action.execute" && row.mode === "enabled");
  const qualification = isRecord(capability?.evidence) && isRecord(capability.evidence.qualificationWindows)
    ? capability.evidence.qualificationWindows : null;
  return node.platform === "win32" && node.status === "active" && node.trustState === "trusted"
    && node.customerAccountId === null && node.customerSiteId === null
    && !!node.lastSeenAt && now.getTime() - node.lastSeenAt.getTime() <= 120_000
    && !!capability && now.getTime() - capability.reportedAt.getTime() <= 120_000
    && actionTypes(node.scopePolicy).includes(QUALIFICATION_WINDOWS_VERIFY_ACTION_TYPE)
    && qualification?.schemaVersion === 1 && qualification.procedureId === QUALIFICATION_WINDOWS_PROCEDURE_ID;
}

export function planQualificationWindowsAction(input: {
  capsuleId: string;
  workspaceState: unknown;
  nodes: QualificationWindowsNode[];
  now?: Date;
}): QualificationPlanResult {
  const now = input.now ?? new Date();
  const workspace = isRecord(input.workspaceState) ? input.workspaceState : {};
  const state = parseQualificationExperimentState(workspace.qualificationExperimentAdmission);
  if (!state || state.status !== "issued" || state.startCount !== 0) return refuse("qualification-not-issued");
  const admission = verifyQualificationExperimentAdmission(state.token, { now });
  if (!admission.ok) return refuse("qualification-admission-invalid");
  const binding = admission.data.binding;
  if (binding.workroomId !== input.capsuleId || binding.phase !== "verify" || binding.executorMode !== "native-edge"
    || binding.requiredPlatform !== "win32" || !binding.candidate || !binding.targetProductionPaths
    || binding.targetProductionPaths.length !== binding.targetProductionBlobIds.length
    || binding.allowedPaths.length !== binding.candidate.testBlobIds.length) {
    return refuse("qualification-binding-invalid");
  }
  const nodes = input.nodes.filter((node) => eligible(node, now));
  if (nodes.length !== 1) return refuse(nodes.length ? "qualification-node-ambiguous" : "qualification-node-unavailable");
  const node = nodes[0]!;
  const actionKey = `ra_qw_${createHash("sha256").update(`${state.bindingDigest}:${node.nodeId}`).digest("hex").slice(0, 24)}`;
  const parameters = {
    version: 1, backlogItemId: binding.itemId, workroomId: binding.workroomId,
    repository: binding.repositoryFullName, baseSha: binding.baseSha, headSha: binding.headSha,
    protocolPath: binding.protocol.path, protocolBlobSha: binding.protocol.providerBlobId,
    productionBlobs: binding.targetProductionPaths.map((path, i) => ({ path, blobSha: binding.targetProductionBlobIds[i] })),
    testBlobs: binding.allowedPaths.map((path, i) => ({ path, blobSha: binding.candidate!.testBlobIds[i] })),
    qualificationBindingDigest: state.bindingDigest, procedureId: QUALIFICATION_WINDOWS_PROCEDURE_ID,
    resultSchemaVersion: 1, maxDurationSeconds: Math.floor(binding.maxDurationMs / 1000), edgeNodeId: node.nodeId,
  };
  return { ...ok(), binding, plan: { actionKey, edgeNodeRowId: node.id, parameters,
    evidence: { governance: "signed-qualification-admission", qualificationAdmission: admission.data,
      qualificationBindingDigest: state.bindingDigest } } };
}

export async function materializeQualificationWindowsAction(input: {
  db: QualificationActionDb;
  capsuleId: string;
  requestedByPrincipalId: string;
  requestedByUserId: string;
  authorityDecisionId?: string;
  now?: Date;
}): Promise<QualificationMaterializeResult> {
  const now = input.now ?? new Date();
  const room = await input.db.workroom.findUnique({ where: { capsuleId: input.capsuleId } });
  if (!room) return refuse("qualification-workroom-missing");
  const nodes = await input.db.edgeNode.findMany({ where: { platform: "win32", trustState: "trusted", status: "active" },
    include: { capabilityRows: true } });
  const planned = planQualificationWindowsAction({ capsuleId: input.capsuleId, workspaceState: room.workspaceState, nodes, now });
  if (!planned.ok) return planned;
  if (await input.db.remoteAction.findUnique({ where: { actionKey: planned.plan.actionKey } })) {
    return refuse("qualification-action-already-exists");
  }
  const workspace = isRecord(room.workspaceState) ? room.workspaceState : {};
  const state = parseQualificationExperimentState(workspace.qualificationExperimentAdmission)!;
  const rfcId = `RFC-QUAL-${planned.plan.actionKey.slice(-12).toUpperCase()}`;
  const change = await input.db.changeRequest.create({ data: {
    rfcId, title: "Run the bounded Windows qualification procedure",
    description: `Execute the signed qualification binding for ${planned.binding.itemId} on one trusted native Windows node.`,
    type: "standard", scope: "platform", riskLevel: "low", status: "approved",
    submittedAt: now, assessedAt: now, approvedAt: now,
    impactReport: { actionType: QUALIFICATION_WINDOWS_VERIFY_ACTION_TYPE, actionKey: planned.plan.actionKey,
      qualificationBindingDigest: state.bindingDigest, authorityDecisionId: input.authorityDecisionId ?? null },
    changeItems: { create: [{ itemType: "qualification-experiment", title: "Run the closed Windows handle-replacement procedure",
      impactDescription: "Uses only server-bound immutable files in an isolated temporary directory.",
      rollbackPlan: "The native handler always restores or removes its isolated temporary fixture before reporting." }] },
  }, select: { id: true } });
  await input.db.remoteAction.create({ data: { actionKey: planned.plan.actionKey,
    actionType: QUALIFICATION_WINDOWS_VERIFY_ACTION_TYPE, edgeNodeId: planned.plan.edgeNodeRowId,
    customerAccountId: null, customerSiteId: null, parameters: planned.plan.parameters,
    riskClass: "low", requestedByPrincipalId: input.requestedByPrincipalId,
    approvalState: "approved", approvedByPrincipalId: input.requestedByPrincipalId,
    changeRequestId: change.id, status: "queued", evidence: planned.plan.evidence } });
  await input.db.workroom.update({ where: { id: room.id }, data: { workspaceState: { ...workspace,
    qualificationExperimentAdmission: { ...state, status: "started", startCount: 1,
      startedAt: now.toISOString(), taskId: planned.plan.actionKey } } } });
  await input.db.workroomActivity.create({ data: { workCapsuleId: room.id, kind: "qualification-action-queued",
    summary: "Queued the signed native Windows qualification procedure.", recordedById: input.requestedByUserId,
    recordedByAgentId: input.requestedByPrincipalId, payload: { actionKey: planned.plan.actionKey,
      qualificationBindingDigest: state.bindingDigest, edgeNodeId: planned.plan.edgeNodeRowId,
      researchSatisfied: false, authorityDecisionId: input.authorityDecisionId ?? null } } });
  return { ...ok(), actionKey: planned.plan.actionKey };
}

