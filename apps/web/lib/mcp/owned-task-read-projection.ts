import { createHash } from "node:crypto";
import { z } from "zod";
import type { ToolResult } from "../mcp-tool-types";
import type { McpTaskRunRow, TaskLifecycleResult } from "./tasks-lifecycle";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "../tak/tool-result-budget";

type RecordValue = Record<string, unknown>;
type TextProjection = { text: string; truncated: boolean; sha256: string; originalChars: number };
type TextSlot = { projection: TextProjection; value: string; previouslyTruncated: boolean };
const ref = z.string().min(1).max(512);
const maybeRef = ref.nullable().optional();
const count = z.number().int().nonnegative().safe();
const maybeCount = count.nullable().optional();
const flag = z.boolean().optional();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const wireStatus = z.enum(["working", "input_required", "completed", "failed", "cancelled"]);
const recordedAt = z.string().datetime({ offset: true });
const nullableText = z.string().nullable().optional();
const observationFacts = z.object({ settlement: z.literal("unknown").optional(), providerId: maybeRef,
  observedAtMissing: flag, exitCode: z.number().int().nullable().optional(), signal: maybeRef,
  timedOut: flag, outerProcessClosed: flag, childProcessClosure: z.literal("unverified").optional(),
  stdoutPresent: flag, stderrPresent: flag, terminalStatus: maybeRef, terminalSubtype: maybeRef,
  eventId: ref.optional(), attempt: maybeCount, state: maybeRef, writerToolName: ref.optional(), writerAttempt: maybeCount,
  dispatchContract: maybeRef, historical: flag, kind: ref.optional(), failureKind: ref.optional(), resumeMode: ref.optional(),
  id: ref.optional(), executionMode: ref.optional(), success: flag, receiptId: ref.optional(), gate: ref.optional(),
  decision: z.enum(["pass", "fail", "not-applicable"]).optional(), writerExecutionId: ref.optional(),
  authorityDecisionId: ref.optional(), authorityTaskRunId: ref.optional(),
}).refine(value => Object.keys(value).length > 0);

// These schemas strip unknown properties at each object boundary. An invalid
// recognized outcome is a refusal; arbitrary nested task data is never copied.
const eligibility = z.object({ sensitivity: ref, residencyPolicy: ref, excludedCount: count,
  exclusions: z.array(z.object({ bucket: ref, count })).max(20) });
const uncertainty = z.object({ schemaVersion: z.literal(1), kind: z.literal("execution-uncertain"),
  settlement: z.literal("unknown"), providerId: ref.optional(), observedAt: recordedAt.optional(),
  diagnostics: z.object({ exitCode: z.number().int().nullable(), signal: maybeRef, timedOut: z.boolean(),
    outerProcessClosed: z.boolean(), stdoutPresent: z.boolean(), stderrPresent: z.boolean(),
    childProcessClosure: z.literal("unverified"), terminalResult: z.object({
      status: z.enum(["success", "error", "unknown"]), type: z.enum(["result", "unknown"]),
      subtype: ref, isError: z.boolean().nullable(), hint: ref,
    }).optional(),
  }).optional(),
});
const rawProgress = z.object({
  summary: nullableText, error: nullableText, errorCode: maybeRef,
  executionUncertainty: uncertainty.nullable().optional(),
});
const approval = z.object({ envelopeId: ref, delegatingUserId: ref, taskRunId: maybeRef,
  status: ref, expiresAt: recordedAt.nullable(), approveHref: ref, declineHref: ref,
  inboxHref: z.literal("/workspace/inbox"), nextAction: z.string(),
});
const sharedFacts = z.object({ requiresApproval: flag, resumable: flag, waitReason: maybeRef,
  retryAuthorized: z.literal(false).optional(), replayAllowed: z.literal(false).optional(),
  approval: approval.optional(),
});
const resourceWait = z.object({ schemaVersion: z.literal(1), kind: z.literal("provider-capacity"),
  failureKind: z.enum(["capacity", "busy"]), resumeMode: z.literal("same-taskrun"), attempt: count,
  observedAt: recordedAt, reason: maybeRef, nextAttemptAt: recordedAt.optional(),
});
const terminalWriterWait = z.object({ schemaVersion: z.literal(1), kind: z.literal("missing-terminal-writer"),
  writerToolName: ref, resumeMode: z.literal("same-taskrun"), attempt: count, observedAt: recordedAt,
  dispatchContract: z.enum(["required-tool-call", "receipt-verified"]).optional(),
  noncompliance: z.literal("prose-without-required-writer").optional(),
  capacityDeferred: z.enum(["capacity", "busy"]).optional(),
  writerRejection: z.object({ schemaVersion: z.literal(1), error: ref, message: z.string(), observedAt: recordedAt }).optional(),
  validationFailure: z.object({ error: ref, message: z.string() }).optional(),
});
const waitFacts = z.object({ resourceWait: resourceWait.nullable().optional(), terminalWriterWait: terminalWriterWait.nullable().optional(),
  terminalWriterDispatchFailure: z.object({ schemaVersion: z.literal(1), code: z.literal("required-terminal-writer-not-enforceable"),
    writerToolName: ref, observedAt: recordedAt }).nullable().optional(),
});
const inventory = z.object({ schemaVersion: z.literal(1),
  status: z.enum(["observed", "unavailable", "over-budget", "binding-mismatch", "changed"]),
  scope: z.literal("task-linked-records-only"), captureComplete: z.literal(false), settlement: z.literal("unknown"),
  counts: z.object({ taskArtifacts: count, toolExecutions: count, approvalEnvelopes: count, asyncOperations: count }).optional(),
  missingEvidence: z.array(z.object({ code: ref, owner: ref })).max(30),
});
const originalResult = z.object({ schemaVersion: z.literal(1), taskRunId: ref,
  classification: z.enum(["receipt-complete", "proven-not-dispatched", "proven-settled-without-receipt", "unknown"]),
  readOnly: z.literal(true), replayAllowed: z.literal(false), bounded: z.literal(true), reason: z.string(),
  binding: z.object({ requestDigest: sha, checkpointUpdatedAt: recordedAt, attempt: maybeCount, dispatchAttempt: maybeCount,
    writerAttempt: maybeCount, writerToolName: ref, reviewerAgentId: ref, itemId: ref, gate: ref, workroomId: ref }).optional(),
  observations: z.array(z.object({ source: ref, recordedAt, digest: sha,
    facts: observationFacts,
  })).max(20),
  receipt: z.object({ receiptId: ref, gate: ref.optional(), decision: z.enum(["pass", "fail", "not-applicable"]) }).optional(),
  missingProof: z.array(ref).max(40), proofInventory: inventory.optional(), proofInventoryUnavailable: z.literal("budget").optional(),
});
const recovery = z.object({
  classification: z.enum(["superseded", "completed", "canceled", "authorization-required", "active-execution",
    "execution-uncertain", "routing-blocked", "capacity-wait", "infrastructure-inconclusive"]),
  deadlineAt: recordedAt.nullable().optional(), recoveryAttempt: maybeCount,
  budget: z.enum(["available", "unknown", "expired", "exhausted"]).optional(),
  executing: flag, eligibilityBlocked: flag, eligibility: z.array(eligibility).max(5).optional(),
  routingEligibility: z.array(eligibility).max(5).optional(), reason: nullableText, successorTaskRunId: maybeRef,
  capacityRecovery: z.object({ requestDigest: sha, checks: count, nextCheckAt: recordedAt, reason: maybeRef }).nullable().optional(),
  manualRecoveryWait: flag, requestDigest: sha.nullable().optional(), remainingAttempts: maybeCount,
  pollUseful: flag, nextAction: z.string(),
  details: z.object({ observedAt: recordedAt.optional(), taskUpdatedAt: recordedAt.optional(),
    nodes: z.array(z.object({ taskNodeId: ref, status: ref, updatedAt: recordedAt.optional(), digestMatches: z.boolean(),
      providerOutcome: z.enum(["not-dispatched", "inconclusive", "unknown"]), settlement: z.enum(["verified", "unverified"]),
      routingEligibility: z.array(eligibility).max(5).optional(),
    })).max(100),
    truncated: z.boolean(), unresolvedNodeIds: z.array(ref).max(100),
    remediation: z.object({ state: ref, verificationId: maybeRef, executionSettled: z.boolean(), retryAuthorized: z.literal(false),
      eligibilityVerified: flag, nextAction: z.string() }),
  }).optional(),
});
const nativeReceipt = z.object({
  schemaVersion: z.enum(["semantic-change-review-receipt.v2", "semantic-change-review-receipt.v3"]),
  artifactType: ref.optional(), capsuleId: ref.optional(), baseTreeHash: ref.optional(), headTreeHash: ref.optional(),
  diffDigest: sha.optional(), policyVersion: ref.optional(), reviewerVersion: ref.optional(),
  specialistIds: z.array(ref).max(20).optional(), sourceHeadSha: ref.optional(), failureAnalysisDigest: sha.optional(),
  disposition: z.enum(["reviewed", "auto-pass"]).optional(), risk: z.enum(["low", "medium", "high", "critical"]).optional(),
  result: z.object({ decision: z.enum(["pass", "fail", "inconclusive"]), summary: z.string(),
    parseError: z.literal(true).optional(), inconclusiveReason: nullableText,
    failureAnalysisReview: z.object({ adequate: z.boolean(), rationale: z.string() }).optional(),
    routingEligibility: z.array(eligibility).max(5).optional(),
  }),
}).refine(value => value.schemaVersion !== "semantic-change-review-receipt.v3" || value.artifactType !== undefined);
const evidence = z.object({ id: ref.nullable(), state: z.enum(["available", "unavailable"]),
  recordedAt: recordedAt.optional(), receipt: nativeReceipt.optional(),
  receiptTruncated: z.literal(true).optional(), receiptSha256: sha.optional(),
});
const provenance = z.object({ asyncOperationId: ref, requestDigest: sha, contractFamily: ref,
  providerId: maybeRef, modelId: maybeRef, providerOperationId: maybeRef,
  checkpointSequence: maybeCount, transitionSequence: maybeCount,
});
const asyncOperation = z.object({ asyncOperationId: ref, status: ref, providerId: maybeRef, modelId: maybeRef,
  requestDigest: sha.optional(), checkpointSequence: maybeCount, transitionSequence: maybeCount,
  progressPct: z.number().finite().nullable().optional(), progressMessage: nullableText, expiresAt: recordedAt.optional(),
  cancellationRequested: flag, nextAction: nullableText,
});

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("incompatible");
  return value as RecordValue;
}

function incompatible(): ToolResult {
  return { success: false, error: "owned_task_read_incompatible", message: "The task read cannot preserve its recorded outcome safely." };
}
function tooLarge(): ToolResult {
  return { success: false, error: "owned_task_read_too_large", message: "Mandatory task outcome facts exceed the bounded read budget." };
}

/** Pure, nonblocking projection of already-admitted canonical data. No authority
 * or receipt is inferred here, and no lifecycle content/body is forwarded. */
export function projectOwnedTaskRead(input: {
  mode: "status" | "result"; task: McpTaskRunRow; lifecycle: TaskLifecycleResult;
  originKind: "external" | "native" | "initiative" | "durable";
}): ToolResult {
  try {
    if (input.lifecycle.kind !== "ok") return incompatible();
    const outer = record(input.lifecycle.value);
    const canonical = input.mode === "result" ? record(outer.structuredContent) : outer;
    const taskId = ref.parse(canonical.taskId);
    if (taskId !== input.task.taskRunId) return incompatible();
    const status = wireStatus.parse(canonical.status);
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    if (canonical.terminal !== undefined && canonical.terminal !== terminal) return incompatible();
    const isError = input.mode === "result" ? z.boolean().parse(outer.isError) : status === "failed";
    const data: RecordValue = { schemaVersion: 1, projection: "owned-mcp-task.v1", mode: input.mode,
      taskId, status, terminal, isError, createdAt: input.task.createdAt.toISOString(),
      lastUpdatedAt: input.task.updatedAt.toISOString(), completedAt: input.task.completedAt?.toISOString() ?? null,
      readOnly: true, retryAuthorized: false,
    };
    if (input.originKind === "durable") {
      // TaskRun projection can lag the bound operation. Keep its dates labeled
      // separately; absent operation dates stay unknown instead of borrowing
      // an older task checkpoint and implying operation freshness/completion.
      data.taskLastUpdatedAt = data.lastUpdatedAt;
      data.taskCompletedAt = data.completedAt;
      data.lastUpdatedAt = canonical.lastUpdatedAt == null ? null : recordedAt.parse(canonical.lastUpdatedAt);
      data.completedAt = canonical.completedAt == null ? null : recordedAt.parse(canonical.completedAt);
    }
    const slots: TextSlot[] = [];
    const text = (value: string, prior?: { truncated: boolean; sha256: string; originalChars: number }): TextProjection => {
      const projection = { text: "", truncated: value.length > 0 || prior?.truncated === true,
        sha256: prior?.sha256 ?? createHash("sha256").update(value, "utf8").digest("hex"),
        originalChars: prior?.originalChars ?? value.length };
      slots.push({ projection, value, previouslyTruncated: prior?.truncated === true });
      return projection;
    };
    const facts = sharedFacts.parse(canonical);
    if (facts.requiresApproval === true && !facts.approval) return incompatible();
    Object.assign(data, facts);
    if (facts.approval) data.approval = { ...facts.approval, nextAction: text(facts.approval.nextAction) };

    const progress = record(input.task.progressPayload ?? {});
    // Validate known uncertainty in status reads too; unknown versions are not
    // silently presented as ordinary success. The raw object never leaves here.
    const parsedProgress = rawProgress.parse(progress);
    const waits = waitFacts.parse(progress);
    if (parsedProgress.executionUncertainty) data.executionUncertainty = parsedProgress.executionUncertainty;
    if (waits.resourceWait) data.resourceWait = waits.resourceWait;
    if (waits.terminalWriterWait) {
      data.terminalWriterWait = { ...waits.terminalWriterWait,
        ...(waits.terminalWriterWait.writerRejection ? { writerRejection: { ...waits.terminalWriterWait.writerRejection,
          message: text(waits.terminalWriterWait.writerRejection.message) } } : {}),
        ...(waits.terminalWriterWait.validationFailure ? { validationFailure: { ...waits.terminalWriterWait.validationFailure,
          message: text(waits.terminalWriterWait.validationFailure.message) } } : {}),
      };
    }
    if (waits.terminalWriterDispatchFailure) data.terminalWriterDispatchFailure = waits.terminalWriterDispatchFailure;

    if (canonical.recovery !== undefined) {
      if (input.originKind !== "native") return incompatible();
      const value = recovery.parse(canonical.recovery);
      data.recovery = { ...value, nextAction: text(value.nextAction), ...(value.reason != null ? { reason: text(value.reason) } : {}),
        ...(value.details ? { details: { ...value.details, remediation: { ...value.details.remediation,
          nextAction: text(value.details.remediation.nextAction) } } } : {}),
      };
    }
    if (canonical.asyncOperation !== undefined) {
      if (input.originKind !== "durable") return incompatible();
      const value = asyncOperation.parse(canonical.asyncOperation);
      data.asyncOperation = { ...value, ...(value.nextAction != null ? { nextAction: text(value.nextAction) } : {}),
        ...(value.progressMessage != null ? { progressMessage: text(value.progressMessage) } : {}) };
    }
    if (input.originKind === "initiative") {
      const value = originalResult.parse(canonical.originalResult);
      if (value.taskRunId !== taskId || (value.classification === "receipt-complete" && !value.receipt)) return incompatible();
      data.originalResult = { ...value, reason: text(value.reason) };
    } else if (canonical.originalResult !== undefined) return incompatible();

    if (input.mode === "result") {
      const answerRequired = status === "completed" || status === "failed";
      if (input.originKind === "native" && answerRequired && canonical.evidence === undefined) return incompatible();
      if (input.originKind === "external") {
        if ((status === "completed" || status === "failed")
          && !parsedProgress.summary?.trim() && !parsedProgress.error?.trim()) return incompatible();
        if (parsedProgress.summary != null) data.summary = text(parsedProgress.summary);
        if (parsedProgress.error != null) data.error = text(parsedProgress.error);
        if (parsedProgress.errorCode != null) data.errorCode = parsedProgress.errorCode;
      }
      if (input.originKind === "native" && canonical.evidence !== undefined) {
        const value = evidence.parse(canonical.evidence);
        if ((value.state === "available" && (!value.id || !value.receipt))
          || (value.state === "unavailable" && value.receipt)) return incompatible();
        if (value.receiptTruncated && !value.receiptSha256) return incompatible();
        data.evidence = { ...value, ...(value.receipt ? { receipt: { ...value.receipt, result: {
          ...value.receipt.result, summary: text(value.receipt.result.summary),
          ...(value.receipt.result.inconclusiveReason != null ? { inconclusiveReason: text(value.receipt.result.inconclusiveReason) } : {}),
          ...(value.receipt.result.failureAnalysisReview ? { failureAnalysisReview: {
            adequate: value.receipt.result.failureAnalysisReview.adequate,
            rationale: text(value.receipt.result.failureAnalysisReview.rationale),
          } } : {}),
        } } } : {}) };
      }
      if (input.originKind === "durable") {
        if (answerRequired && ![canonical.resultText, canonical.errorMessage].some(value =>
          typeof value === "string" && value.trim().length > 0)) return incompatible();
        for (const field of ["resultText", "errorMessage"] as const) {
          const raw = canonical[field];
          if (raw === null || raw === undefined) continue;
          if (typeof raw !== "string") return incompatible();
          const prefix = field === "resultText" ? "result" : "error";
          const priorTruncated = canonical[`${prefix}Truncated`];
          const priorHash = canonical[`${prefix}Sha256`];
          const priorChars = canonical[`${prefix}OriginalChars`];
          if (priorTruncated !== undefined || priorHash !== undefined || priorChars !== undefined) {
            const prior = { truncated: z.boolean().parse(priorTruncated), sha256: sha.parse(priorHash), originalChars: count.parse(priorChars) };
            if (prior.originalChars < raw.length || (!prior.truncated && (prior.originalChars !== raw.length
              || prior.sha256 !== createHash("sha256").update(raw, "utf8").digest("hex")))) return incompatible();
            data[field] = text(raw, prior);
          } else data[field] = text(raw);
        }
        if (canonical.provenance !== undefined) data.provenance = provenance.parse(canonical.provenance);
      }
    }
    const output: ToolResult = { success: true, message: "Bounded read-only task snapshot.", data };
    const baseSize = JSON.stringify(output).length;
    if (baseSize > MCP_ROUTE_TOOL_RESULT_CHAR_CAP) return tooLarge();
    // Equal serialized budgets prevent a long summary starving the error or
    // next-action text. Control characters and lone surrogates count after JSON
    // escaping; mandatory identities/hashes/facts were already budgeted above.
    const budget = Math.max(0, Math.floor((MCP_ROUTE_TOOL_RESULT_CHAR_CAP - baseSize) / Math.max(1, slots.length)) - 2);
    for (const slot of slots) {
      let low = 0;
      let high = slot.value.length;
      while (low < high) {
        const next = Math.ceil((low + high) / 2);
        if (JSON.stringify(slot.value.slice(0, next)).length - 2 <= budget) low = next;
        else high = next - 1;
      }
      slot.projection.text = slot.value.slice(0, low);
      slot.projection.truncated = slot.previouslyTruncated || low < slot.value.length;
    }
    return JSON.stringify(output).length <= MCP_ROUTE_TOOL_RESULT_CHAR_CAP ? output : tooLarge();
  } catch {
    return incompatible();
  }
}
