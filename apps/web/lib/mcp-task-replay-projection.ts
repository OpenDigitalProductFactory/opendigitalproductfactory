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
  const resourceWait = parseResourceWaitProjection(input.existing.progressPayload);
  return {
    kind: "result",
    result: {
      taskRunId: input.existing.taskRunId,
      status: input.existing.status,
      idempotentReplay: true,
      requiresApproval: input.existing.status === "input-required" && !terminalWriterWait && !terminalWriterEscalation,
      ...(terminalWriterEscalation ? {
        resumable: false,
        waitReason: terminalWriterEscalationWaitReason(terminalWriterEscalation),
        content: remoteTaskContent(terminalWriterEscalationMessage(terminalWriterEscalation)),
        structuredContent: terminalWriterEscalationStructuredContent(terminalWriterEscalation),
        isError: false,
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
