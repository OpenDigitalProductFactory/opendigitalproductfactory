// Vitest colours its summary: the count follows an SGR code directly
// (`\x1b[31m1 failed`), so a `\b` before the digit never matched and every
// coloured real failure was graded runner-termination (BI-E3B7C1AB). Match on
// ANSI-stripped text, anchored to the summary line.
const FAILED_TEST_SUMMARY_RE = /^\s*(?:Test Files|Tests)\s+(?:[^\r\n]*\D)?[1-9]\d* failed\b/im;
const FAILED_TEST_FILE_RE = /^\s*(?:[×✕✖]\s+)?FAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/gm;
// eslint-disable-next-line no-control-regex
const ANSI_SGR_RE = /\x1B\[[0-9;]*m/g;

function stripAnsi(text) {
  return String(text ?? "").replace(ANSI_SGR_RE, "");
}

export function hasFailedTestSummary(outputTail) {
  return FAILED_TEST_SUMMARY_RE.test(stripAnsi(outputTail));
}

/** Distinct failing test files named by Vitest's `FAIL <path>` lines, first seen first. */
export function failedTestFilesFromOutput(outputTail) {
  const files = [];
  for (const match of stripAnsi(outputTail).matchAll(FAILED_TEST_FILE_RE)) {
    if (!files.includes(match[1])) files.push(match[1]);
  }
  return files;
}

export { BoundedTextTail } from "./bounded-text-tail.mjs";

export function classifyVitestAttempt({
  status,
  signal,
  error,
  outputTail = "",
  deadlineExceeded = false,
  closeTimedOut = false,
}) {
  if (deadlineExceeded || closeTimedOut) return "runner-termination";
  if (status === 0 && !signal && !error) return "passed";
  if (hasFailedTestSummary(outputTail)) return "test-failure";
  if (
    status === null
    || status === undefined
    || status === -1
    || status === 0xffffffff
    || signal
    || error
  ) {
    return "runner-termination";
  }
  return "runner-termination";
}

export function shouldRetryVitestAttempt({ classification, attempt }) {
  return classification === "runner-termination" && attempt === 1;
}

function normalizeAttempt(raw, { attempt, workers }) {
  const classification = classifyVitestAttempt(raw);
  return {
    attempt,
    workers,
    classification,
    status: raw.status ?? null,
    unsignedStatus: raw.status === -1 ? 0xffffffff : (raw.status ?? null),
    signal: raw.signal ?? null,
    error: raw.error
      ? {
          name: raw.error.name ?? "Error",
          code: raw.error.code ?? null,
          message: raw.error.message ?? String(raw.error),
        }
      : null,
    outputTail: raw.outputTail ?? "",
    lastCompletedTest: raw.lastCompletedTest ?? null,
    childPid: raw.childPid ?? null,
    hostSamples: raw.hostSamples ?? [],
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    maxDurationMs: raw.maxDurationMs ?? null,
    deadlineAt: raw.deadlineAt ?? null,
    deadlineExceeded: raw.deadlineExceeded === true,
    stopAttemptedAt: raw.stopAttemptedAt ?? null,
    stopResult: raw.stopResult ?? null,
    forceAttemptedAt: raw.forceAttemptedAt ?? null,
    forceResult: raw.forceResult ?? null,
    closeTimedOutAt: raw.closeTimedOutAt ?? null,
    closeTimedOut: raw.closeTimedOut === true,
    failedTestFiles: classification === "test-failure" ? failedTestFilesFromOutput(raw.outputTail) : [],
  };
}

export async function runVitestWithRecovery({
  runAttempt,
  initialWorkers = 4,
  retryWorkers = 2,
  allowRetry = true,
  onAttempt = () => {},
} = {}) {
  if (typeof runAttempt !== "function") {
    throw new TypeError("runVitestWithRecovery requires runAttempt");
  }

  const attempts = [];
  const workerCounts = allowRetry ? [initialWorkers, retryWorkers] : [initialWorkers];
  for (let index = 0; index < workerCounts.length; index += 1) {
    const attempt = index + 1;
    const workers = workerCounts[index];
    const normalized = normalizeAttempt(
      await runAttempt({ attempt, workers }),
      { attempt, workers },
    );
    attempts.push(normalized);
    await onAttempt(normalized);

    if (!allowRetry || !shouldRetryVitestAttempt({
      classification: normalized.classification,
      attempt,
    })) {
      const runnerTerminated = normalized.classification === "runner-termination";
      return {
        status: normalized.classification === "passed"
          ? 0
          : runnerTerminated
            ? 86
            : (normalized.status ?? 1),
        classification: normalized.classification,
        recovered: attempt > 1 && normalized.classification === "passed",
        failedTestFiles: normalized.failedTestFiles,
        attempts,
      };
    }
  }

  throw new Error("unreachable Vitest recovery state");
}
