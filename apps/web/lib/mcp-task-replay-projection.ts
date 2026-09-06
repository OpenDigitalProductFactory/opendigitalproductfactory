import { parseResourceWaitProjection } from "./mcp-task-capacity-contract";
import {
  recoverTerminalWriterEscalation,
  terminalWriterEscalationMessage,
  terminalWriterEscalationStructuredContent,
  terminalWriterEscalationWaitReason,
} from "./mcp-task-terminal-writer-escalation";

export type TerminalWriterWait = {
  schemaVersion: 1;
  kind: "missing-terminal-writer";
  writerToolName: string;
  resumeMode: "same-taskrun";
  attempt: number;
  observedAt: string;
  dispatchContract?: "required-tool-call";
  noncompliance?: "prose-without-required-writer";
  validationFailure?: { error: string; message: string };
};

type TerminalWriterDispatchFailure = {
  schemaVersion: 1;
  code: "required-terminal-writer-not-enforceable";
  writerToolName: string;
  observedAt: string;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function remoteTaskContent(text: string) {
  return [{ type: "text", text }];
}

export function parseTerminalWriterWait(value: unknown): TerminalWriterWait | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)["terminalWriterWait"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const wait = candidate as Record<string, unknown>;
  if (
    wait["schemaVersion"] !== 1
    || wait["kind"] !== "missing-terminal-writer"
    || !optionalString(wait["writerToolName"])
    || wait["resumeMode"] !== "same-taskrun"
    || !Number.isInteger(wait["attempt"])
    || Number(wait["attempt"]) < 1
    || !optionalString(wait["observedAt"])
    || (wait["dispatchContract"] !== undefined && wait["dispatchContract"] !== "required-tool-call")
    || (wait["noncompliance"] !== undefined && wait["noncompliance"] !== "prose-without-required-writer")
  ) return null;
  return wait as TerminalWriterWait;
}

function parseTerminalWriterDispatchFailure(
  value: unknown,
  wait: TerminalWriterWait | null,
): TerminalWriterDispatchFailure | null {
  if (!wait || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)["terminalWriterDispatchFailure"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const failure = candidate as Record<string, unknown>;
  if (
    failure["schemaVersion"] !== 1
    || failure["code"] !== "required-terminal-writer-not-enforceable"
    || optionalString(failure["writerToolName"]) !== wait.writerToolName
    || optionalString(failure["observedAt"]) !== wait.observedAt
  ) return null;
  return failure as TerminalWriterDispatchFailure;
}

export function projectRemoteTaskReplay(input: {
  existing: {
    taskRunId: string;
    status: string;
    progressPayload: unknown;
    a2aMetadata: unknown;
  };
  requestMatches: boolean;
}): { kind: "result"; result: Record<string, unknown> } {
  if (!input.requestMatches) {
    return {
      kind: "result",
      result: {
        content: remoteTaskContent(
          "This requestKey is already bound to a different external coworker request. Retry with the original immutable packet or use a new requestKey.",
        ),
        structuredContent: {
          error: "idempotency_conflict",
          action: "Retry with the original immutable packet or use a new requestKey.",
          taskRunId: input.existing.taskRunId,
        },
        isError: true,
      },
    };
  }
  const terminalWriterEscalation = recoverTerminalWriterEscalation(input.existing.progressPayload);
  const terminalWriterWait = parseTerminalWriterWait(input.existing.progressPayload);
  const terminalWriterDispatchFailure = parseTerminalWriterDispatchFailure(
    input.existing.progressPayload,
    terminalWriterWait,
  );
  const resourceWait = parseResourceWaitProjection(input.existing.progressPayload);
  const progress = input.existing.progressPayload && typeof input.existing.progressPayload === "object"
    ? input.existing.progressPayload as Record<string, unknown> : {};
  return {
    kind: "result",
    result: {
      taskRunId: input.existing.taskRunId,
      status: input.existing.status,
      idempotentReplay: true,
      requiresApproval: input.existing.status === "input-required" && !terminalWriterWait && !terminalWriterEscalation
        && typeof progress.approvalEnvelopeId === "string" && progress.approvalEnvelopeId.length > 0,
      ...(terminalWriterEscalation ? {
        resumable: false,
        waitReason: terminalWriterEscalationWaitReason(terminalWriterEscalation),
        content: remoteTaskContent(terminalWriterEscalationMessage(terminalWriterEscalation)),
        structuredContent: terminalWriterEscalationStructuredContent(terminalWriterEscalation),
        isError: false,
      } : terminalWriterDispatchFailure ? {
        resumable: true,
        waitReason: terminalWriterDispatchFailure.code,
        structuredContent: { error: terminalWriterDispatchFailure.code },
        isError: true,
      } : terminalWriterWait ? {
        resumable: true,
        waitReason: terminalWriterWait.kind,
      } : resourceWait ? {
        resumable: true,
        waitReason: "provider-capacity",
      } : {}),
      progressPayload: input.existing.progressPayload,
      a2aMetadata: input.existing.a2aMetadata,
    },
  };
}
