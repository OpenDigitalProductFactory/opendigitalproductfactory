import { cron } from "@/lib/jobs/triggers";
import { executePersistedRemoteTask } from "@/lib/mcp-task-background-worker";
import { executePersistedSemanticReview, reconcileSemanticReviews } from "@/lib/change-review/semantic-review-background";
import {
  externalMcpTaskAsyncEnabled,
  reconcilePersistedRemoteTaskDispatches,
  REMOTE_TASK_EXECUTION_EVENT,
} from "@/lib/mcp-task-background-dispatch";
import { buildPipelineConcurrency } from "../admission";
import { jobs } from "@/lib/jobs";
import { gateAtEntry, gateBetweenSteps } from "../quiescence-gates";

export const mcpTaskRunExecute = jobs.createFunction(
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

export const mcpTaskRunDispatchReconciliation = jobs.createFunction(
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
    // BI-A835D300: independent reviews delivered items owe, routed without the author's client.
    const reviews = await step.run("dispatch-owed-independent-reviews", async () =>
      (await import("@/lib/backlog/initiative-readiness/server-reviewer-dispatch")).dispatchOwedIndependentReviews(),
    );
    return { native, external, reviews };
  },
);
