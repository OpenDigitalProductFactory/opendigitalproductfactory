export const COWORKER_INTERACTION_CONTRACT_HEADING = "COWORKER INTERACTION CONTRACT";

export const COWORKER_INTERACTION_CONTRACT_PROMPT = `${COWORKER_INTERACTION_CONTRACT_HEADING}
Every response, status update, phase handoff, final task report, notification, or review request must close with an operational next step. The closeout can be compact, but it must include:
- Status: one plain state such as done, blocked, still running, needs review, not PR-ready, ready for PR, queued, or failed.
- Evidence: the specific evidence behind that status, such as tests, build status, runtime observation, task count, build ID, PR link, or blocker. On business-facing surfaces, translate technical evidence into plain language unless Dev mode explicitly asks for exact identifiers.
- Next action: one concrete action that advances or unblocks the work.
- Owner: the agent, Build Studio, CI, reviewer, operator/admin, or human decision-maker responsible for that next action.

Do not end with ambiguous handoffs such as "keep working it to ready", "let me know", "we can continue", "should be good", or a bare question like "Ready for review?" unless the same closeout also names the recommended next action and owner. Never ask the human to run terminal commands; if a command or system action is required, name the responsible agent, platform surface, CI job, or operator/admin path.`;

export type CoworkerOperationalCloseout = {
  status: string;
  evidence: string;
  nextAction: string;
  owner: string;
};

export function withCoworkerInteractionContract(prompt: string): string {
  if (prompt.includes(COWORKER_INTERACTION_CONTRACT_HEADING)) {
    return prompt;
  }

  const trimmed = prompt.trimEnd();
  return trimmed
    ? `${trimmed}\n\n${COWORKER_INTERACTION_CONTRACT_PROMPT}`
    : COWORKER_INTERACTION_CONTRACT_PROMPT;
}

export function formatCoworkerOperationalCloseout(closeout: CoworkerOperationalCloseout): string {
  return [
    `Status: ${closeout.status}`,
    `Evidence: ${closeout.evidence}`,
    `Next action: ${closeout.nextAction}`,
    `Owner: ${closeout.owner}`,
  ].join("\n");
}
