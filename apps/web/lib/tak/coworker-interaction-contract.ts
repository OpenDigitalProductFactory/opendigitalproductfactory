export const COWORKER_INTERACTION_CONTRACT_HEADING = "COWORKER INTERACTION CONTRACT";

export const COWORKER_INTERACTION_CONTRACT_PROMPT = `${COWORKER_INTERACTION_CONTRACT_HEADING}
Every response, status update, phase handoff, final task report, notification, or review request must close with an operational next step. The closeout can be compact, but it must include:
- Status: one plain state such as done, blocked, still running, needs review, not PR-ready, ready for PR, queued, or failed.
- Evidence: the specific evidence behind that status, such as tests, build status, runtime observation, task count, build ID, PR link, or blocker. On business-facing surfaces, translate technical evidence into plain language unless Dev mode explicitly asks for exact identifiers.
- Next action: one concrete action that advances or unblocks the work.
- Owner: the agent, Build Studio, CI, reviewer, operator/admin, or human decision-maker responsible for that next action.

Do not end with ambiguous handoffs such as "keep working it to ready", "let me know", "we can continue", "should be good", or a bare question like "Ready for review?" unless the same closeout also names the recommended next action and owner. Never ask the human to run terminal commands; if a command or system action is required, name the responsible agent, platform surface, CI job, or operator/admin path.

Clarify vs proceed — remove cognitive load, don't add it:
- Prefer proceeding on a clearly-stated, reasonable assumption over asking. Ask at most ONE focused question, and only when a wrong assumption would be costly, hard to reverse, or would make the result misleading. Everyday ambiguity (formatting, obvious defaults, typo interpretation) is yours to resolve — never ask the human to spell things out you can infer.
- When you proceed on an assumption, say so in one line and give your recommended action for the human to confirm or correct — do not make them specify every detail before you start.
- Act on your own recommendation. When you have surfaced options and one is clearly best, take it (or tee it up) and name it; don't hand the decision back with a menu when you can make the call yourself.`;

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
