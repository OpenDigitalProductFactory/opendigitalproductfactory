import { inngest } from "@/lib/queue/inngest-client";

import type { AsyncOperationTransitionEvent } from "@/lib/inference/async-operation-outbox";
import type { AsyncOperationWake } from "@/lib/inference/async-operation-queue";

/**
 * Outer event-transport adapter for the provider-neutral async lifecycle.
 * Keeping Inngest at this adapter boundary prevents inference policy and state
 * machines from depending on queue implementation details.
 */
export async function enqueueAsyncOperationWake(wake: AsyncOperationWake): Promise<void> {
  await inngest.send({
    name: "inference/async-operation.run",
    data: {
      operationId: wake.operationId,
      notBefore: wake.notBefore.toISOString(),
    },
  });
}

export async function publishAsyncOperationTransitionEvent(
  event: AsyncOperationTransitionEvent,
): Promise<void> {
  await inngest.send({
    id: event.eventId,
    name: event.name,
    data: event.data,
    ts: new Date(event.data.occurredAt).getTime(),
  });
}
