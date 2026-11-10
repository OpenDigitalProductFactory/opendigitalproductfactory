import { buildTerminalToolReminder, type TerminalToolPolicy, type TerminalToolRecord } from "./terminal-tool-policy";

/** Preserve the governed tool surface: truncation is not completed prose or a
 * reason to rotate providers. The caller owns the existing continuation budget. */
export function terminalTruncationMessage(
  policy: TerminalToolPolicy,
  records: readonly TerminalToolRecord[],
  exhausted: boolean,
): string {
  if (exhausted) {
    return `The review response reached the output-token limit before ${policy.writerToolName} ` +
      "could be recorded, and its bounded continuation allowance is exhausted. " +
      "The same TaskRun remains resumable. No receipt was created. " +
      "Review the route's output budget before resuming; this is not a completed prose refusal.";
  }
  return "Your response reached the output-token limit before completing the governed step. " +
    "Finish that step concisely using only the currently permitted tools; do not return a prose assessment. " +
    buildTerminalToolReminder(policy, records);
}
