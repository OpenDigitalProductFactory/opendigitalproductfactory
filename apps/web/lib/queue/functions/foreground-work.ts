import { jobs } from "@/lib/jobs";
import { FOREGROUND_WORK_EVENT } from "@/lib/agent/foreground-work-contract";
import { buildPipelineConcurrency } from "../admission";
import { gateBetweenSteps } from "../quiescence-gates";

export const foregroundWorkRun = jobs.createFunction({
  id: "agent/foreground-work-run", retries: 0,
  concurrency: buildPipelineConcurrency({ limit: 4 }),
  triggers: [{ event: FOREGROUND_WORK_EVENT }],
}, async ({ event, step }) => {
  const gate = await gateBetweenSteps(step, "before-foreground-work");
  if (gate.reason) throw new Error("Foreground work is waiting for platform availability.");
  const { taskRunId } = event.data as { taskRunId: string };
  if (typeof taskRunId !== "string") return { kind: "invalid-request" };
  return step.run("execute-retained-foreground-work", async () => {
    const { executeForegroundWork } = await import("@/lib/agent/foreground-work-worker");
    return executeForegroundWork(taskRunId);
  });
});
