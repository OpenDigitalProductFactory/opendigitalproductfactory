// Inngest job: execute an approved research proposal (BI-8A58C65A slice C).
// Triggered by `research/execute.run` (enqueued from approveResearch's
// onApproved seam). Runs the research engine and lands draft corpus material;
// the pure logic + outcome stamping live in lib/wiki/research-execution.ts.

import { inngest } from "@/lib/queue/inngest-client";
import {
  runResearchExecution,
  type RunResearchExecutionInput,
} from "@/lib/wiki/research-execution";

export const researchExecute = inngest.createFunction(
  {
    id: "research/execute",
    retries: 1,
    // One research run per org at a time — keeps web/LLM load + corpus writes serial.
    concurrency: [{ key: "event.data.organizationId", limit: 1 }],
    triggers: [{ event: "research/execute.run" }],
  },
  async ({ event, step }) => {
    const result = await step.run("run-research-execution", async () =>
      runResearchExecution(event.data as unknown as RunResearchExecutionInput),
    );
    return { ok: true, ...result };
  },
);
