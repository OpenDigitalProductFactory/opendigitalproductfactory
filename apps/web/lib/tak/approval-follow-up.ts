// The message the chat panel sends for the person after they authorize a
// coworker's request inline, so the coworker reacts to the result. One wording
// for the legacy proposal card and the envelope card (BI-7BCC87BB, spec D2 S1:
// "keeping today's 'Result: <id>' text"). Pure, client-safe.

export function approvalFollowUpMessage(toolName: string, resultEntityId?: string | null): string {
  const action = toolName.replace(/_/g, " ");
  return resultEntityId
    ? `I approved ${action}. Result: ${resultEntityId}. What's next?`
    : `I approved ${action}. What's next?`;
}
