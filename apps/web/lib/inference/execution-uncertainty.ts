/** A closed local process does not establish whether remote effects committed. */
export const EXECUTION_UNCERTAIN_MESSAGE = "The native execution did not return a settled result. Inspect the existing execution and reconcile its recorded effects before authorizing another execution.";

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
};

export function sanitizeNativeCliDiagnostics(value: unknown): NativeCliDiagnostics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return {
    exitCode: typeof row.exitCode === "number" && Number.isSafeInteger(row.exitCode) && Math.abs(row.exitCode) <= 65535 ? row.exitCode : null,
    signal: typeof row.signal === "string" && /^SIG[A-Z0-9]{1,12}$/.test(row.signal) ? row.signal : null,
    timedOut: row.timedOut === true, outerProcessClosed: row.outerProcessClosed === true,
    stdoutPresent: row.stdoutPresent === true, stderrPresent: row.stderrPresent === true,
    childProcessClosure: "unverified",
  };
}

/** Unknown marker versions also hold replay: malformed evidence is not clearance. */
export function hasExecutionUncertainty(progress: unknown): boolean {
  return !!progress && typeof progress === "object" && !Array.isArray(progress)
    && (progress as Record<string, unknown>).executionUncertainty != null;
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
