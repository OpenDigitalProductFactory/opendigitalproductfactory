import { prisma } from "@dpf/db";
import { computeNextRunAt } from "@/lib/ai-provider-types";
import { inngest } from "@/lib/queue/inngest-client";

import {
  CODE_GRAPH_EVENT_NAME,
  CODE_GRAPH_GRAPH_KEY,
  CODE_GRAPH_JOB_ID,
  CODE_GRAPH_JOB_NAME,
  CODE_GRAPH_JOB_SCHEDULE,
} from "./constants";

export type QueueCodeGraphReconcileInput = {
  reason: "git-commit" | "git-backup" | "scheduled" | "manual";
  headSha?: string | null;
  branch?: string | null;
  graphKey?: string;
};

export async function registerCodeGraphScheduledJob(): Promise<void> {
  const now = new Date();
  const nextRunAt = computeNextRunAt(CODE_GRAPH_JOB_SCHEDULE, now);

  await prisma.scheduledJob.upsert({
    where: { jobId: CODE_GRAPH_JOB_ID },
    create: {
      jobId: CODE_GRAPH_JOB_ID,
      name: CODE_GRAPH_JOB_NAME,
      schedule: CODE_GRAPH_JOB_SCHEDULE,
      nextRunAt,
    },
    update: {
      schedule: CODE_GRAPH_JOB_SCHEDULE,
      nextRunAt,
    },
  });
}

export async function queueCodeGraphReconcile(input: QueueCodeGraphReconcileInput): Promise<void> {
  await inngest.send({
    name: CODE_GRAPH_EVENT_NAME,
    data: {
      reason: input.reason,
      headSha: input.headSha ?? null,
      branch: input.branch ?? null,
      graphKey: input.graphKey ?? CODE_GRAPH_GRAPH_KEY,
    },
  });
}
