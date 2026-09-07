import type { GoldenTriangleReceipt } from "@/lib/golden-triangle/receipt";

import type {
  WorkCaseActionVerb,
  WorkCaseActorRef,
  WorkCaseEnforcementMode,
  WorkCaseRef,
  WorkCaseSourceRef,
} from "./case-types";
import type { WorkroomShapeKey } from "./room-shapes";

export type ReceiptEnvelopeStatus = "valid" | "invalid" | "observed" | "failed";

export interface ReceiptEnvelope {
  receiptId: string;
  caseRef?: WorkCaseRef;
  receiptKind: string;
  enforcementMode: WorkCaseEnforcementMode;
  sourceRef: WorkCaseSourceRef;
  actionType?: WorkCaseActionVerb | string;
  status: ReceiptEnvelopeStatus;
  summary: string;
  occurredAt: string;
  actorRef?: WorkCaseActorRef;
  inputDigest?: string;
  outputDigest?: unknown;
  policyRefs: readonly string[];
  governance?: {
    collaborationShape: WorkroomShapeKey;
    authorityLadderLevel: "none" | "discover" | "content" | "action";
    requiredPrincipalRefs: readonly string[];
    decisionInteractionId?: string;
  };
  tak?: {
    gateDecision: "approve" | "decline" | "escalate" | null;
    decisionInteractionId: string | null;
    policyVersion: string | null;
    gaid: string | null;
    principalId: string | null;
    delegationChainId: string | null;
    qualification: unknown;
    evidenceRefs: readonly string[];
    amendmentLineage: readonly string[];
  };
  trace?: {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
  };
  rawRef: {
    table: string;
    id: string;
  };
}

type DateLike = Date | string;

export interface GoldenTriangleReceiptEnvelopeOptions {
  interactionId: string;
  occurredAt: DateLike;
  caseRef?: WorkCaseRef;
}

export interface ToolExecutionReceiptRow {
  id: string;
  toolExecutionId: string;
  receiptKind: string;
  receiptStatus: string;
  executionStatus: string;
  inputFingerprint: string;
  outputDigest: unknown;
  createdAt: DateLike;
}

export interface ToolExecutionReceiptEnvelopeOptions {
  caseRef?: WorkCaseRef;
  actionType?: WorkCaseActionVerb | string;
  policyRefs?: readonly string[];
  collaborationShape?: ReceiptEnvelope["governance"];
}

export interface WorkCapsuleActivityRow {
  id: string;
  workCapsuleId: string;
  kind: string;
  summary: string;
  payload?: unknown;
  recordedAt: DateLike;
  recordedById?: string | null;
  recordedByAgentId?: string | null;
}

export interface WorkItemMessageRow {
  id: string;
  messageId: string;
  workItemId: string;
  senderType: string;
  senderUserId?: string | null;
  senderAgentId?: string | null;
  messageType: string;
  body: string;
  structuredPayload?: unknown;
  createdAt: DateLike;
}

export interface RuntimeVerificationRow {
  id: string;
  verificationId: string;
  kind: string;
  status: string;
  result?: unknown;
  createdAt: DateLike;
}

export interface ExternalEvidenceRecordRow {
  id: string;
  routeContext: string;
  operationType: string;
  target: string;
  provider: string;
  resultSummary: string;
  details?: unknown;
  createdAt: DateLike;
}

export interface DecisionInteractionRow {
  id: string;
  interactionId: string;
  domainClass: string;
  question: string;
  outcomeType: string;
  outcomePayload?: unknown;
  createdAt: DateLike;
}

export interface BacklogItemActivityRow {
  id: string;
  backlogItemId: string;
  kind: string;
  summary: string;
  payload?: unknown;
  recordedAt: DateLike;
}

function iso(value: DateLike): string {
  return value instanceof Date ? value.toISOString() : value;
}

function receiptStatusFromTool(row: ToolExecutionReceiptRow): ReceiptEnvelopeStatus {
  if (row.receiptStatus !== "valid") return "invalid";
  if (/fail|error|denied|rejected/i.test(row.executionStatus)) return "failed";
  return "valid";
}

function enforcementModeFromReceiptKind(receiptKind: string): WorkCaseEnforcementMode {
  return /governed/i.test(receiptKind) ? "governed-action" : "observed-event";
}

function takEnvelope(outputDigest: unknown): ReceiptEnvelope["tak"] | undefined {
  if (!outputDigest || typeof outputDigest !== "object") return undefined;
  const governance = (outputDigest as Record<string, unknown>).governance;
  if (!governance || typeof governance !== "object") return undefined;
  const row = governance as Record<string, unknown>;
  const actor = row.actor && typeof row.actor === "object" ? row.actor as Record<string, unknown> : {};
  const verdict = ["approve", "decline", "escalate"].includes(String(row.gateDecision))
    ? row.gateDecision as "approve" | "decline" | "escalate" : null;
  return {
    gateDecision: verdict,
    decisionInteractionId: typeof row.decisionInteractionId === "string" ? row.decisionInteractionId : null,
    policyVersion: typeof row.policyVersion === "string" ? row.policyVersion : null,
    gaid: typeof actor.gaid === "string" ? actor.gaid : null,
    principalId: typeof actor.principalId === "string" ? actor.principalId : null,
    delegationChainId: typeof row.delegationChainId === "string" ? row.delegationChainId : null,
    qualification: row.qualification ?? null,
    evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs.filter((ref): ref is string => typeof ref === "string") : [],
    amendmentLineage: Array.isArray(row.amendmentLineage)
      ? row.amendmentLineage.filter((ref): ref is string => typeof ref === "string") : [],
  };
}

function observedEnvelope(input: {
  receiptId: string;
  sourceRef: WorkCaseSourceRef;
  rawRef: ReceiptEnvelope["rawRef"];
  summary: string;
  occurredAt: DateLike;
  outputDigest?: unknown;
  actorRef?: WorkCaseActorRef;
}): ReceiptEnvelope {
  return {
    receiptId: input.receiptId,
    receiptKind: "observed-event",
    enforcementMode: "observed-event",
    sourceRef: input.sourceRef,
    status: "observed",
    summary: input.summary,
    occurredAt: iso(input.occurredAt),
    actorRef: input.actorRef,
    outputDigest: input.outputDigest,
    policyRefs: [],
    rawRef: input.rawRef,
  };
}

export function fromGoldenTriangleReceipt(
  receipt: GoldenTriangleReceipt,
  options: GoldenTriangleReceiptEnvelopeOptions,
): ReceiptEnvelope {
  return {
    receiptId: `golden-triangle:${options.interactionId}`,
    caseRef: options.caseRef,
    receiptKind: "golden-triangle",
    enforcementMode: "governed-action",
    sourceRef: {
      kind: "decision-interaction",
      id: options.interactionId,
    },
    status: receipt.matchedRequest ? "valid" : "invalid",
    summary: receipt.summary,
    occurredAt: iso(options.occurredAt),
    inputDigest: JSON.stringify(receipt.requested),
    outputDigest: {
      requested: receipt.requested,
      actual: receipt.actual,
      deviations: receipt.deviations,
      matchedRequest: receipt.matchedRequest,
    },
    policyRefs: [
      `golden-triangle:${receipt.preset}`,
      `governed-by:${receipt.governedBy}`,
    ],
    rawRef: {
      table: "DecisionInteraction",
      id: options.interactionId,
    },
  };
}

export function fromToolExecutionReceipt(
  row: ToolExecutionReceiptRow,
  options: ToolExecutionReceiptEnvelopeOptions = {},
): ReceiptEnvelope {
  const tak = takEnvelope(row.outputDigest);
  return {
    receiptId: row.id,
    caseRef: options.caseRef,
    receiptKind: row.receiptKind,
    enforcementMode: enforcementModeFromReceiptKind(row.receiptKind),
    sourceRef: {
      kind: "source",
      id: row.toolExecutionId,
      sourceType: "tool-execution",
    },
    actionType: options.actionType,
    status: receiptStatusFromTool(row),
    summary: `${row.receiptKind} ${row.receiptStatus} for ${row.toolExecutionId}`,
    occurredAt: iso(row.createdAt),
    inputDigest: row.inputFingerprint,
    outputDigest: row.outputDigest,
    policyRefs: options.policyRefs ?? [
      ...(tak?.policyVersion ? [tak.policyVersion] : []),
      ...(tak?.evidenceRefs ?? []),
    ],
    governance: options.collaborationShape,
    tak,
    rawRef: {
      table: "ToolExecutionReceipt",
      id: row.id,
    },
  };
}

export function fromWorkCapsuleActivity(row: WorkCapsuleActivityRow, options: { capsuleId?: string } = {}): ReceiptEnvelope {
  return observedEnvelope({
    receiptId: `work-capsule-activity:${row.id}`,
    sourceRef: {
      kind: "work-capsule",
      id: options.capsuleId ?? row.workCapsuleId,
      status: row.kind,
    },
    rawRef: { table: "WorkroomActivity", id: row.id },
    summary: row.summary,
    occurredAt: row.recordedAt,
    outputDigest: row.payload,
    actorRef: {
      actorKind: row.recordedByAgentId ? "agent" : row.recordedById ? "person" : "system",
      actorId: row.recordedByAgentId ?? row.recordedById ?? undefined,
    },
  });
}

export function fromWorkItemMessage(row: WorkItemMessageRow): ReceiptEnvelope {
  const actorRef: WorkCaseActorRef = {
    actorKind: row.senderType === "agent" ? "agent" : row.senderType === "user" ? "person" : "system",
    actorId: row.senderAgentId ?? row.senderUserId ?? undefined,
  };
  const payload = row.structuredPayload && typeof row.structuredPayload === "object"
    ? row.structuredPayload as Record<string, unknown>
    : null;
  const nestedReceipt = payload?.receipt && typeof payload.receipt === "object"
    ? payload.receipt as Record<string, unknown>
    : null;
  const lifecycle = payload?.kind === "work-room-lifecycle-receipt" ? payload : nestedReceipt;
  if (lifecycle?.kind === "work-room-lifecycle-receipt") {
    const enforcementMode = lifecycle.enforcementMode === "observed-event"
      ? "observed-event"
      : "governed-action";
    return {
      receiptId: `work-item-message:${row.messageId}`,
      receiptKind: typeof lifecycle.receiptKind === "string" ? lifecycle.receiptKind : "governed-action",
      enforcementMode,
      sourceRef: { kind: "receipt", id: row.messageId, status: row.messageType },
      actionType: typeof lifecycle.operation === "string" ? lifecycle.operation : undefined,
      status: lifecycle.status === "valid" ? "valid" : "invalid",
      summary: row.body,
      occurredAt: iso(row.createdAt),
      actorRef,
      inputDigest: typeof lifecycle.idempotencyKey === "string" ? lifecycle.idempotencyKey : undefined,
      outputDigest: row.structuredPayload,
      policyRefs: Array.isArray(lifecycle.policyRefs)
        ? lifecycle.policyRefs.filter((value): value is string => typeof value === "string")
        : [],
      rawRef: { table: "WorkItemMessage", id: row.id },
    };
  }
  return observedEnvelope({
    receiptId: `work-item-message:${row.messageId}`,
    sourceRef: {
      kind: "work-item",
      id: row.workItemId,
      status: row.messageType,
    },
    rawRef: { table: "WorkItemMessage", id: row.id },
    summary: row.body,
    occurredAt: row.createdAt,
    actorRef,
    outputDigest: row.structuredPayload,
  });
}

export function fromRuntimeVerification(row: RuntimeVerificationRow): ReceiptEnvelope {
  return observedEnvelope({
    receiptId: `runtime-verification:${row.verificationId}`,
    sourceRef: {
      kind: "runtime-verification",
      id: row.verificationId,
      status: row.status,
    },
    rawRef: { table: "RuntimeVerification", id: row.id },
    summary: `${row.kind} ${row.status}`,
    occurredAt: row.createdAt,
    outputDigest: row.result,
  });
}

export function fromExternalEvidenceRecord(row: ExternalEvidenceRecordRow): ReceiptEnvelope {
  return observedEnvelope({
    receiptId: `external-evidence:${row.id}`,
    sourceRef: {
      kind: "evidence",
      id: row.id,
      status: row.operationType,
      sourceType: "external-evidence",
    },
    rawRef: { table: "ExternalEvidenceRecord", id: row.id },
    summary: row.resultSummary,
    occurredAt: row.createdAt,
    outputDigest: {
      routeContext: row.routeContext,
      target: row.target,
      provider: row.provider,
      details: row.details,
    },
  });
}

export function fromDecisionInteraction(row: DecisionInteractionRow): ReceiptEnvelope {
  return observedEnvelope({
    receiptId: `decision-interaction:${row.interactionId}`,
    sourceRef: {
      kind: "decision-interaction",
      id: row.interactionId,
      status: row.outcomeType,
    },
    rawRef: { table: "DecisionInteraction", id: row.id },
    summary: row.question,
    occurredAt: row.createdAt,
    outputDigest: {
      domainClass: row.domainClass,
      outcomePayload: row.outcomePayload,
    },
  });
}

export function fromBacklogItemActivity(row: BacklogItemActivityRow): ReceiptEnvelope {
  return observedEnvelope({
    receiptId: `backlog-item-activity:${row.id}`,
    sourceRef: {
      kind: "source",
      id: row.backlogItemId,
      status: row.kind,
      sourceType: "backlog-item",
    },
    rawRef: { table: "BacklogItemActivity", id: row.id },
    summary: row.summary,
    occurredAt: row.recordedAt,
    outputDigest: row.payload,
  });
}
