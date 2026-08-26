const FAILED_TEST_SUMMARY_RE = /(?:Test Files|Tests)\s+[^\r\n]*\b[1-9]\d* failed\b/i;

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
  if (FAILED_TEST_SUMMARY_RE.test(outputTail)) return "test-failure";
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
        attempts,
      };
    }
  }

  throw new Error("unreachable Vitest recovery state");
}
