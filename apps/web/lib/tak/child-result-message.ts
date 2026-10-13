// A delegated child's result lands in its parent conversation (BI-B3194260,
// design docs/superpowers/specs/2026-10-07-durable-delegation-ledger-design.md
// §4.5; founder decision 2026-10-13: post the result, no automatic parent turn).
//
// One message per child, keyed on the child's TaskRun: a repeated terminal path
// (a retried job, a late failure after completion) never posts twice. The
// parent reads it through its normal chat history on its next turn, so it no
// longer has to poll get_thread_result.

export type ChildOutcome = "completed" | "failed" | "canceled";

/** Long enough to carry a useful answer; the full reply stays on the child thread. */
export const CHILD_RESULT_MESSAGE_LIMIT = 4000;

type ChildResultDb = {
  agentMessage: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
};

export function childResultMessage(input: { agentName: string; outcome: ChildOutcome; text: string | null }): string {
  const body = (input.text ?? "").trim();
  const clipped = body.length > CHILD_RESULT_MESSAGE_LIMIT
    ? `${body.slice(0, CHILD_RESULT_MESSAGE_LIMIT)}…\n\n(The full reply is on the delegated thread.)`
    : body;
  if (input.outcome === "completed") {
    return `${input.agentName} finished the delegated work.${clipped ? `\n\n${clipped}` : ""}`;
  }
  const verb = input.outcome === "canceled" ? "was cancelled" : "could not finish the delegated work";
  return `${input.agentName} ${verb}.${clipped ? ` ${clipped}` : ""}`;
}

/** Post the child's result to its parent thread once. Returns false when it was already posted. */
export async function postChildResultToParent(db: ChildResultDb, input: {
  parentThreadId: string;
  childTaskRunId: string;
  agentId: string | null;
  agentName: string;
  outcome: ChildOutcome;
  text: string | null;
  routeContext: string;
}): Promise<boolean> {
  const existing = await db.agentMessage.findFirst({
    where: { threadId: input.parentThreadId, taskRunId: input.childTaskRunId, role: "assistant" },
    select: { id: true },
  });
  if (existing) return false;
  await db.agentMessage.create({
    data: {
      threadId: input.parentThreadId,
      taskRunId: input.childTaskRunId,
      role: "assistant",
      content: childResultMessage(input),
      agentId: input.agentId,
      routeContext: input.routeContext,
    },
  });
  return true;
}
