import { cron } from "inngest";
import { executePersistedRemoteTask } from "@/lib/mcp-task-background-worker";
import { executePersistedSemanticReview, reconcileSemanticReviews } from "@/lib/change-review/semantic-review-background";
import {
  externalMcpTaskAsyncEnabled,
  reconcilePersistedRemoteTaskDispatches,
  REMOTE_TASK_EXECUTION_EVENT,
} from "@/lib/mcp-task-background-dispatch";
import { buildPipelineConcurrency } from "../admission";
import { inngest } from "../inngest-client";
import { gateAtEntry, gateBetweenSteps } from "../quiescence-gates";

export const mcpTaskRunExecute = inngest.createFunction(
  {
    id: "mcp/task-run-execute",
    retries: 2,
    concurrency: buildPipelineConcurrency({ limit: 4 }),
    triggers: [{ event: REMOTE_TASK_EXECUTION_EVENT }],
  },
  async ({ event, step }) => {
    const gate = await gateBetweenSteps(step, "before-external-task");
    if (gate.reason) {
      throw new Error(`External MCP task remained quiesced: ${gate.reason}`);
    }
    const { taskRunId } = event.data as { taskRunId: string };
    return step.run("execute-persisted-remote-task", async () =>
      await executePersistedSemanticReview(taskRunId) ?? executePersistedRemoteTask({ taskRunId }),
    );
  },
);

export const mcpTaskRunDispatchReconciliation = inngest.createFunction(
  {
    id: "mcp/task-run-dispatch-reconciliation",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("*/2 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "mcp/task-run-dispatch-reconciliation");
    if (!gate.proceed) return gate;
    const native = await step.run("reconcile-native-semantic-reviews", () => reconcileSemanticReviews());
    const external = await step.run("reconcile-submitted-external-tasks", () =>
      reconcilePersistedRemoteTaskDispatches({
        includeOrdinary: externalMcpTaskAsyncEnabled(),
      }),
    );
    return { native, external };
  },
);
