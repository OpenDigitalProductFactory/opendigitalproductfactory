// One instruction on every scheduled turn. Stored prompts already say what to
// do; this says to do it on the first response, so a local model does not
// spend the turn planning.

export const SCHEDULED_TURN_FIRST_ACTION =
  "Call the tool that does the next step in your first response. Do not write a plan or a status essay before that call. If the step is already done, say so in one sentence and stop.";

export function formatScheduledTurnPrompt(title: string, executionPrompt: string): string {
  return `[Scheduled task: ${title}]\n\n${SCHEDULED_TURN_FIRST_ACTION}\n\n${executionPrompt}`;
}
