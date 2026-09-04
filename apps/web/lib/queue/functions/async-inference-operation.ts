import { randomUUID } from "node:crypto";

import {
  publishPrismaAsyncOperationTransitions,
  reconcilePrismaAsyncOperationWakes,
  runPrismaAsyncOperationWake,
} from "@/lib/inference/async-operation-runtime";
import {
  ASYNC_INFERENCE_OPERATION_OUTBOX_CRON,
  ASYNC_INFERENCE_OPERATION_OUTBOX_INNGEST_ID,
  ASYNC_INFERENCE_OPERATION_RECOVERY_CRON,
  ASYNC_INFERENCE_OPERATION_RECOVERY_INNGEST_ID,
  ASYNC_INFERENCE_OPERATION_RUN_EVENT,
  ASYNC_INFERENCE_OPERATION_WORKER_ENABLED_FLAG,
} from "@/lib/inference/async-operation-constants";
import { ASYNC_OPERATION_TRANSITION_EVENT } from "@/lib/inference/async-operation-outbox";
import {
  reconcileDurableInferenceTaskTransitions,
  settleDurableInferenceTaskTransition,
} from "@/lib/mcp-task-durable-inference-transition";
import { inngest } from "../inngest-client";
import { gateAtEntry, gateBetweenSteps } from "../quiescence-gates";

export {
  ASYNC_INFERENCE_OPERATION_OUTBOX_CRON,
  ASYNC_INFERENCE_OPERATION_RECOVERY_CRON,
  ASYNC_INFERENCE_OPERATION_RUN_EVENT,
  ASYNC_INFERENCE_OPERATION_WORKER_ENABLED_FLAG,
};

function workerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const configured = env[ASYNC_INFERENCE_OPERATION_WORKER_ENABLED_FLAG]?.trim().toLowerCase();
  return configured !== "0" && configured !== "false" && configured !== "off";
}

export const asyncInferenceOperationRun = inngest.createFunction(
  {
    id: "inference/async-operation-run",
    retries: 2,
    concurrency: [{ key: "event.data.operationId", limit: 1 }],
    triggers: [{ event: ASYNC_INFERENCE_OPERATION_RUN_EVENT }],
  },
  async ({ event, step }) => {
    if (!workerEnabled()) {
      return { skipped: true, reason: "async-operation-worker-disabled" };
    }
    const eventData = event.data as { operationId?: unknown; notBefore?: unknown };
    const operationId = eventData.operationId;
    if (typeof operationId !== "string" || operationId.length === 0) {
      throw new Error("ASYNC_OPERATION_EVENT_ID_REQUIRED");
    }
    if (typeof eventData.notBefore !== "string") {
      throw new Error("ASYNC_OPERATION_EVENT_NOT_BEFORE_REQUIRED");
    }
    const notBefore = new Date(eventData.notBefore);
    if (!Number.isFinite(notBefore.getTime())) {
      throw new Error("ASYNC_OPERATION_EVENT_NOT_BEFORE_INVALID");
    }
    // `EventPayload.ts` records when an event occurred; it does not schedule
    // future delivery. Durable sleep is the queue-owned timing boundary.
    await step.sleepUntil("wait-until-operation-due", notBefore);
    const gate = await gateBetweenSteps(step as never, "async-operation-provider-boundary");
    if (gate.reason) {
      throw new Error(`Async operation remained quiesced: ${gate.reason}`);
    }
    const result = await step.run("run-fenced-async-operation-step", () =>
      runPrismaAsyncOperationWake({
        operationId,
        workerId: `inngest-${randomUUID()}`,
      }),
    );
    await step.run("publish-async-operation-transitions", () =>
      publishPrismaAsyncOperationTransitions({ limit: 50 }),
    );
    return result;
  },
);

export const asyncInferenceOperationReconciliation = inngest.createFunction(
  {
    id: ASYNC_INFERENCE_OPERATION_RECOVERY_INNGEST_ID,
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ cron: ASYNC_INFERENCE_OPERATION_RECOVERY_CRON }],
  },
  async ({ step }) => {
    if (!workerEnabled()) {
      return { skipped: true, reason: "async-operation-worker-disabled" };
    }
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    const wakes = await step.run("reconcile-due-async-operation-wakes", () =>
      reconcilePrismaAsyncOperationWakes({ limit: 50 }),
    );
    const transitionGate = await gateBetweenSteps(
      step as never,
      "durable-task-transition-reconciliation",
    );
    if (transitionGate.reason) {
      throw new Error(`Durable TaskRun reconciliation remained quiesced: ${transitionGate.reason}`);
    }
    const taskRuns = await step.run("reconcile-durable-task-run-projections", () =>
      reconcileDurableInferenceTaskTransitions({ limit: 50 }),
    );
    return { wakes, taskRuns };
  },
);

export const asyncInferenceOperationOutbox = inngest.createFunction(
  {
    id: ASYNC_INFERENCE_OPERATION_OUTBOX_INNGEST_ID,
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ cron: ASYNC_INFERENCE_OPERATION_OUTBOX_CRON }],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("publish-async-operation-transition-outbox", () =>
      publishPrismaAsyncOperationTransitions({ limit: 50 }),
    );
  },
);

export const asyncInferenceOperationTaskRunTransition = inngest.createFunction(
  {
    id: "mcp/task-run-durable-inference-transition",
    retries: 2,
    concurrency: [{ key: "event.data.operationId", limit: 1 }],
    triggers: [{ event: ASYNC_OPERATION_TRANSITION_EVENT }],
  },
  async ({ event, step }) => {
    const eventData = event.data as {
      operationId?: unknown;
      sequence?: unknown;
      status?: unknown;
    };
    const operationId = eventData.operationId;
    if (typeof operationId !== "string" || operationId.length === 0) {
      throw new Error("ASYNC_OPERATION_EVENT_ID_REQUIRED");
    }
    if (!Number.isInteger(eventData.sequence) || Number(eventData.sequence) < 0) {
      throw new Error("ASYNC_OPERATION_EVENT_SEQUENCE_INVALID");
    }
    const gate = await gateBetweenSteps(step as never, "durable-task-transition");
    if (gate.reason) {
      throw new Error(`Durable TaskRun transition remained quiesced: ${gate.reason}`);
    }
    return step.run("settle-bound-mcp-task-run", () =>
      settleDurableInferenceTaskTransition({
        operationId,
        sequence: Number(eventData.sequence),
        status: eventData.status,
      }),
    );
  },
);
