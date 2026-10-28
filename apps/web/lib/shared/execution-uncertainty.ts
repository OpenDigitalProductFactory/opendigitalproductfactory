/** A closed local process does not establish whether remote effects committed. */
export const EXECUTION_UNCERTAIN_MESSAGE = "The existing execution has no verified settled result. Inspect that execution and reconcile its recorded effects before authorizing another execution.";

export const CLI_RESULT_SUBTYPES = ["success", "error_during_execution", "error_max_turns",
  "error_max_budget_usd", "error_max_structured_output_retries"] as const;
const CLI_RESULT_HINTS = ["quota", "auth", "overloaded", "model", "unclassified"] as const;
export type CliTerminalResultMetadata = {
  status: "success" | "error" | "unknown";
  type: "result" | "unknown";
  subtype: typeof CLI_RESULT_SUBTYPES[number] | "unknown";
  isError: boolean | null;
  hint: typeof CLI_RESULT_HINTS[number];
};

export type ExecutionUncertainty = {
  schemaVersion: 1;
  kind: "execution-uncertain";
  settlement: "unknown";
  providerId?: string;
  observedAt?: string;
  diagnostics?: NativeCliDiagnostics;
};

export type NativeCliDiagnostics = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outerProcessClosed: boolean;
  stdoutPresent: boolean;
  stderrPresent: boolean;
  childProcessClosure: "unverified";
  terminalResult?: CliTerminalResultMetadata;
  /** Classification of the CLI's own stderr verdict; the stderr text itself is never kept. */
  cliFailureHint?: typeof CLI_RESULT_HINTS[number];
};

export function sanitizeNativeCliDiagnostics(value: unknown): NativeCliDiagnostics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const rawTerminal = row.terminalResult;
  const terminal = rawTerminal && typeof rawTerminal === "object" && !Array.isArray(rawTerminal)
    ? rawTerminal as Record<string, unknown> : null;
  const terminalResult: CliTerminalResultMetadata | undefined = terminal ? {
    status: terminal.status === "success" || terminal.status === "error" ? terminal.status : "unknown",
    type: terminal.type === "result" ? "result" : "unknown",
    subtype: CLI_RESULT_SUBTYPES.find(value => value === terminal.subtype) ?? "unknown",
    isError: typeof terminal.isError === "boolean" ? terminal.isError : null,
    hint: CLI_RESULT_HINTS.find(value => value === terminal.hint) ?? "unclassified",
  } : undefined;
  return {
    exitCode: typeof row.exitCode === "number" && Number.isSafeInteger(row.exitCode) && Math.abs(row.exitCode) <= 65535 ? row.exitCode : null,
    signal: typeof row.signal === "string" && /^SIG[A-Z0-9]{1,12}$/.test(row.signal) ? row.signal : null,
    timedOut: row.timedOut === true, outerProcessClosed: row.outerProcessClosed === true,
    stdoutPresent: row.stdoutPresent === true, stderrPresent: row.stderrPresent === true,
    childProcessClosure: "unverified",
    ...(terminalResult ? { terminalResult } : {}),
    ...(row.cliFailureHint !== undefined
      ? { cliFailureHint: CLI_RESULT_HINTS.find(value => value === row.cliFailureHint) ?? "unclassified" } : {}),
  };
}

/** Unknown marker versions also hold replay: malformed evidence is not clearance. */
export function hasExecutionUncertainty(progress: unknown): boolean {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return false;
  const row = progress as Record<string, unknown>;
  if (row.executionUncertainty != null) return true;
  const wait = row.terminalWriterWait;
  if (wait == null) return false;
  if (typeof wait !== "object" || Array.isArray(wait)) return true;
  const prior = wait as Record<string, unknown>;
  // Earlier loops erased thrown native errors into unclassified writer waits.
  // Missing execution evidence cannot authorize replay or a replacement reviewer.
  const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  if (prior.schemaVersion !== 1 || prior.kind !== "missing-terminal-writer"
    || prior.resumeMode !== "same-taskrun" || !text(prior.writerToolName)
    || !Number.isSafeInteger(prior.attempt) || Number(prior.attempt) < 1
    || !text(prior.observedAt)) return true;
  if (prior.dispatchContract === "required-tool-call" || prior.dispatchContract === "receipt-verified") return false;
  if (prior.capacityDeferred === "capacity" || prior.capacityDeferred === "busy") return false;
  const rejection = prior.writerRejection && typeof prior.writerRejection === "object" && !Array.isArray(prior.writerRejection)
    ? prior.writerRejection as Record<string, unknown> : null;
  if (rejection?.schemaVersion === 1 && text(rejection.error) && text(rejection.message)
    && text(rejection.observedAt) && Number.isFinite(Date.parse(rejection.observedAt))
    && Date.parse(rejection.observedAt) <= Date.parse(prior.observedAt)) return false;
  const refusal = row.terminalWriterDispatchFailure && typeof row.terminalWriterDispatchFailure === "object"
    && !Array.isArray(row.terminalWriterDispatchFailure) ? row.terminalWriterDispatchFailure as Record<string, unknown> : null;
  return !(refusal?.schemaVersion === 1 && refusal.code === "required-terminal-writer-not-enforceable"
    && refusal.writerToolName === prior.writerToolName && refusal.observedAt === prior.observedAt);
}

/** Persist only identity and observed facts, never error output, prompts or credentials. */
export function executionUncertaintyFromError(error: unknown): ExecutionUncertainty {
  const providerId = error && typeof error === "object"
    ? (error as Record<string, unknown>).providerId : undefined;
  const diagnostics = sanitizeNativeCliDiagnostics(error && typeof error === "object"
    ? (error as Record<string, unknown>).diagnostics : undefined);
  return { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown",
    ...(typeof providerId === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(providerId) ? { providerId } : {}),
    ...(diagnostics ? { diagnostics } : {}) };
}
