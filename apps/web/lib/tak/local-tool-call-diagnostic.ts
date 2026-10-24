/**
 * When a local model answers a tool-backed turn with text alone, does the loop
 * give up with a diagnostic, or spend its one corrective nudge?
 *
 * Lives in its own module so the condition is testable directly, rather than as
 * an inline predicate inside the agentic loop's iteration body.
 */

/**
 * Local model, iteration 0, text-only on a tool-backed turn: exit with a
 * diagnostic rather than nudge. One nudge will not teach a small local model to
 * use tools mid-turn, and the earlier carve-out here caused 200-iteration hangs
 * on /build when routing fell back to local (FB-71FB3A53).
 *
 * `requireTools` is exempt: text cannot satisfy that contract at all, so giving
 * up before nudging makes the capability unreachable rather than degraded, and
 * throws away the decision `shouldNudge` already made
 * (`permitsTextCompletion = !requireToolExecution`). Still bounded by
 * `maxNudges = 1`, so such a turn gets one reminder and then takes this exit.
 *
 * Rationale and the measured failure: the capacity-deferral-is-not-a-writer-
 * failure design, §8 (BI-2FA5A874).
 */
export function shouldExitWithLocalToolCallDiagnostic(params: {
  shouldNudgeNow: boolean;
  iteration: number;
  executedToolCount: number;
  providerId: string | null | undefined;
  requireTools: boolean;
}): boolean {
  if (!params.shouldNudgeNow) return false;
  if (params.iteration !== 0) return false;
  if (params.executedToolCount !== 0) return false;
  if (params.providerId !== "local") return false;
  if (params.requireTools) return false;
  return true;
}
