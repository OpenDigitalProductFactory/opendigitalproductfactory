// apps/web/lib/build/blocked-cause.ts
//
// Why is a specialist task BLOCKED? (BI-2B9E16CC)
//
// classifyOutcome() maps EVERY failed CLI result to "BLOCKED" — a mid-work
// timeout and "I need a product decision before I can proceed" are the same
// terminal verdict. And the only existing recovery,
// classifyRetrySafePreDispatchFailure, deliberately gives up once
// durationMs > 1000 (it guards against silently re-running work that may have
// already applied side effects), so every CLI death AFTER dispatch strands the
// build in `build` phase with no path forward.
//
// Meanwhile the agentic path has always retried failures MAX_SPECIALIST_RETRIES
// times with a "previous attempt had issues" prompt. That asymmetry is the bug:
// the same failure is recoverable on one path and terminal on the other.
//
// This splits the two causes so the CLI path can take the bounded retry the
// agentic path already takes.
//
// Bias is deliberate: mis-reading substantive as infrastructure costs ONE extra
// bounded re-dispatch; mis-reading infrastructure as substantive strands the
// build permanently. So an ambiguous transient signal resolves to infrastructure.
// A specialist that reports a real obstacle in prose matches nothing here and
// stays substantive — it is not retried, because retrying will not answer it.

export type BlockedCause = "infrastructure" | "substantive";

/** Process/transport deaths — the CLI never got to finish its own reasoning. */
const INFRASTRUCTURE_PATTERNS: RegExp[] = [
  /timed?\s?out|timeout/,
  /econnreset|econnrefused|etimedout|enetunreach|epipe|socket hang ?up/,
  /connection (reset|refused|closed|aborted)/,
  /\b(429|500|502|503|504)\b/,
  /service unavailable|internal server error|bad gateway|gateway time/,
  /overloaded|rate.?limit|retry-after|quota exceeded|capacity/,
  /sigkill|sigterm|killed|out of memory|oom|heap limit/,
  /stream (error|closed unexpectedly)|network error|fetch failed/,
  /provider (unavailable|error)|no healthy provider/,
];

/**
 * Classify a failed specialist dispatch.
 *
 * @param content stdout/stderr from the run
 * @param exitCode process exit code, when known
 */
export function classifyBlockedCause(input: {
  content: string;
  exitCode?: number | null;
}): BlockedCause {
  const content = (input.content ?? "").toLowerCase();

  // No output at all is a process that died before it could say anything —
  // never a considered refusal.
  if (content.trim().length === 0) return "infrastructure";

  // 137 = SIGKILL (OOM-killer / docker stop), 143 = SIGTERM, 124 = coreutils
  // `timeout`. These are the harness killing the process, not a verdict.
  if (input.exitCode === 137 || input.exitCode === 143 || input.exitCode === 124) {
    return "infrastructure";
  }

  return INFRASTRUCTURE_PATTERNS.some((pat) => pat.test(content))
    ? "infrastructure"
    : "substantive";
}
