export const TERMINAL_WRITER_MAX_ATTEMPTS = 3;

export type TerminalWriterEscalation = {
  schemaVersion: 1;
  code: "terminal_writer_retry_exhausted" | "terminal_writer_context_truncated";
  writerToolName: string;
  attempt: number;
  action: "select-different-reviewer-provider";
  observedAt: string;
};

/**
 * BI-A57B6185: the governed writer WAS called and refused the packet. This is
 * not a missing writer. The packet is wrong (stale head, malformed objective
 * link, ...) and the writer's own error names the fix. It must never count as
 * an "omitted" attempt, never escalate to select-different-reviewer, and must
 * reach the caller verbatim.
 */
export type TerminalWriterRejection = {
  schemaVersion: 1;
  error: string;
  message: string;
  observedAt: string;
};

export const TERMINAL_WRITER_REJECTED_WAIT_REASON = "terminal-writer-rejected";

type WriterExecutionRecord = {
  name: string;
  result: { success: boolean; error?: string; message?: string };
};

/** Last failed call of the writer, as a rejection, or null when the writer never ran or succeeded. */
export function lastTerminalWriterRejection(
  writerToolName: string,
  records: readonly WriterExecutionRecord[],
  observedAt = new Date().toISOString(),
): TerminalWriterRejection | null {
  const last = records.filter((record) => record.name === writerToolName).at(-1);
  if (!last || last.result.success) return null;
  return {
    schemaVersion: 1,
    error: nonEmptyString(last.result.error) ?? "writer-rejected",
    message: nonEmptyString(last.result.message) ?? "The writer returned no message.",
    observedAt,
  };
}

export function terminalWriterRejectionMessage(writerToolName: string, rejection: TerminalWriterRejection): string {
  return `${writerToolName} was called and rejected the packet: ${rejection.error}: ${rejection.message} Fix the packet and resume the same TaskRun; switching reviewer will not help.`;
}

export function terminalWriterRejectionStructuredContent(
  writerToolName: string,
  attempt: number,
  rejection: TerminalWriterRejection,
) {
  return {
    error: "terminal_writer_rejected",
    attempt,
    writerToolName,
    writerRejection: { error: rejection.error, message: rejection.message },
    action: "fix-packet-and-resume",
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function terminalWriterRetryIsExhausted(attempt: number): boolean {
  return Number.isInteger(attempt) && attempt >= TERMINAL_WRITER_MAX_ATTEMPTS;
}

export function createTerminalWriterEscalation(args: {
  writerToolName: string;
  attempt: number;
  code?: TerminalWriterEscalation["code"];
  observedAt?: string;
}): TerminalWriterEscalation {
  return {
    schemaVersion: 1,
    code: args.code ?? "terminal_writer_retry_exhausted",
    writerToolName: args.writerToolName,
    attempt: args.attempt,
    action: "select-different-reviewer-provider",
    observedAt: args.observedAt ?? new Date().toISOString(),
  };
}

export function parseTerminalWriterEscalation(value: unknown): TerminalWriterEscalation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)["terminalWriterEscalation"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const escalation = candidate as Record<string, unknown>;
  if (
    escalation["schemaVersion"] !== 1
    || !["terminal_writer_retry_exhausted", "terminal_writer_context_truncated"].includes(String(escalation["code"]))
    || !nonEmptyString(escalation["writerToolName"])
    || !Number.isInteger(escalation["attempt"])
    || Number(escalation["attempt"]) < 1
    || escalation["action"] !== "select-different-reviewer-provider"
    || !nonEmptyString(escalation["observedAt"])
  ) return null;
  if (
    escalation["code"] === "terminal_writer_retry_exhausted"
    && Number(escalation["attempt"]) < TERMINAL_WRITER_MAX_ATTEMPTS
  ) return null;
  return escalation as TerminalWriterEscalation;
}

export function recoverTerminalWriterEscalation(value: unknown): TerminalWriterEscalation | null {
  const explicit = parseTerminalWriterEscalation(value);
  if (explicit) return explicit;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const progress = value as Record<string, unknown>;
  const failure = progress["terminalWriterContextFailure"];
  const wait = progress["terminalWriterWait"];
  if (!wait || typeof wait !== "object" || Array.isArray(wait)) return null;
  const waitRecord = wait as Record<string, unknown>;
  // A recorded rejection is a packet problem, not an omitted writer: never
  // manufacture a retry-exhausted escalation from it on replay (BI-A57B6185).
  const rejection = waitRecord["writerRejection"];
  if (rejection && typeof rejection === "object" && !Array.isArray(rejection)) return null;
  const writerToolName = nonEmptyString(waitRecord["writerToolName"]);
  const attempt = Number(waitRecord["attempt"]);
  if (
    waitRecord["schemaVersion"] !== 1
    || waitRecord["kind"] !== "missing-terminal-writer"
    || waitRecord["resumeMode"] !== "same-taskrun"
    || !writerToolName
    || !Number.isInteger(attempt)
    || attempt < 1
  ) return null;
  if (failure && typeof failure === "object" && !Array.isArray(failure)) {
    const failureRecord = failure as Record<string, unknown>;
    if (failureRecord["code"] === "terminal_writer_context_truncated") {
      return createTerminalWriterEscalation({
        code: "terminal_writer_context_truncated",
        writerToolName,
        attempt,
        observedAt: nonEmptyString(failureRecord["observedAt"]) ?? new Date().toISOString(),
      });
    }
  }
  if (!terminalWriterRetryIsExhausted(attempt)) return null;
  return createTerminalWriterEscalation({
    writerToolName,
    attempt,
    observedAt: nonEmptyString(waitRecord["observedAt"]) ?? new Date().toISOString(),
  });
}

export function terminalWriterEscalationWaitReason(escalation: TerminalWriterEscalation): string {
  return escalation.code === "terminal_writer_context_truncated"
    ? "terminal-writer-context-exhausted"
    : "terminal-writer-retry-exhausted";
}

export function terminalWriterEscalationStructuredContent(escalation: TerminalWriterEscalation) {
  return {
    error: escalation.code,
    attempt: escalation.attempt,
    writerToolName: escalation.writerToolName,
    action: escalation.action,
  };
}

export function terminalWriterEscalationMessage(escalation: TerminalWriterEscalation): string {
  if (escalation.code === "terminal_writer_context_truncated") {
    return "The immutable review packet is larger than the safe hydration limit. Stop replaying this TaskRun and select a different eligible reviewer/provider for the same review packet.";
  }
  return "The required writer was omitted on three attempts. Stop replaying this TaskRun and select a different eligible reviewer/provider for the same immutable review packet.";
}
