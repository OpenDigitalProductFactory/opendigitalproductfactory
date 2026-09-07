// Starting a deliberation is one action, in one place.
//
// `orchestrateDeliberation` only PERSISTS the run graph. A separate runner
// executes it, and it only wakes on `deliberation/run.start`. Forgetting that
// event does not fail — it leaves a run at `pending` with queued nodes and no
// outcome, forever, which reads from the outside as "the panel produced
// nothing" rather than "the panel never ran". That is exactly how the
// governance triage panel shipped: ten runs created, zero started.
//
// So the send lives here rather than being retyped at each call site.

import { inngest } from "../queue/inngest-client";

export type StartDeliberationInput = {
  deliberationRunId: string;
  taskRunId: string;
  threadId?: string | null;
  userId: string;
};

/**
 * Wake the runner for an orchestrated deliberation graph.
 *
 * Throws if the event cannot be sent: a caller that swallows this would be
 * reporting a panel it never started.
 */
export async function startDeliberationRun(input: StartDeliberationInput): Promise<void> {
  await inngest.send({
    name: "deliberation/run.start",
    data: {
      deliberationRunId: input.deliberationRunId,
      taskRunId: input.taskRunId,
      threadId: input.threadId ?? null,
      userId: input.userId,
    },
  });
}
