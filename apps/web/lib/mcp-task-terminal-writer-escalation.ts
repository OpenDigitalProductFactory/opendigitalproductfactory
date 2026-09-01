export const TERMINAL_WRITER_MAX_ATTEMPTS = 3;

export type TerminalWriterEscalation = {
  schemaVersion: 1;
  code: "terminal_writer_retry_exhausted" | "terminal_writer_context_truncated";
  writerToolName: string;
  attempt: number;
  action: "select-different-reviewer-provider";
  observedAt: string;
};

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
  if (
    !failure || typeof failure !== "object" || Array.isArray(failure)
    || !wait || typeof wait !== "object" || Array.isArray(wait)
  ) return null;
  const failureRecord = failure as Record<string, unknown>;
  const waitRecord = wait as Record<string, unknown>;
  const writerToolName = nonEmptyString(waitRecord["writerToolName"]);
  const attempt = Number(waitRecord["attempt"]);
  if (
    failureRecord["code"] !== "terminal_writer_context_truncated"
    || !writerToolName
    || !Number.isInteger(attempt)
    || attempt < 1
  ) return null;
  return createTerminalWriterEscalation({
    code: "terminal_writer_context_truncated",
    writerToolName,
    attempt,
    observedAt: nonEmptyString(failureRecord["observedAt"]) ?? new Date().toISOString(),
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
