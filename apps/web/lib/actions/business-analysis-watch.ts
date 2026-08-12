"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  parseBusinessAnalysisWatchConfig,
  type BusinessAnalysisWatchConfig,
} from "@/lib/performance/business-analysis-watch";
import { loadBusinessPerformance } from "@/lib/performance/business-performance-provider";
import {
  scheduleAgentTaskFor,
} from "@/lib/operate/scheduled-jobs/agent-task-core";
import { BUSINESS_ANALYSIS_WATCH_TASK_KIND } from "@/lib/operate/scheduled-jobs/agent-task-kind";

type CreateBusinessAnalysisWatchInput = {
  title: string;
  schedule: string;
  config: BusinessAnalysisWatchConfig;
};

export async function createBusinessAnalysisWatchAction(
  input: CreateBusinessAnalysisWatchInput,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not authenticated." };
  try {
    const config = parseBusinessAnalysisWatchConfig(input.config);
    const performance = await loadBusinessPerformance({ userId: session.user.id });
    if (performance.status !== "ready") {
      return { ok: false, error: "A current Performance snapshot is required before watching a question." };
    }
    const metricKey = config.plan.metrics[0]!.key;
    const metric = performance.metricValues.find(({ key }) => key === metricKey);
    if (!metric || metric.availability !== "available" || metric.value === null || !metric.sourceWatermark) {
      return { ok: false, error: "The selected metric needs a current available value before it can be watched." };
    }
    const freshConfig = parseBusinessAnalysisWatchConfig({
      ...config,
      baseline: {
        value: metric.value,
        sourceWatermark: metric.sourceWatermark.toISOString(),
      },
      lastEvaluation: null,
    });
    const result = await scheduleAgentTaskFor(session.user.id, {
      agentId: "operations-manager",
      title: input.title.trim() || `Watch ${metric.label}`,
      prompt: "Evaluate the accepted business analysis plan deterministically.",
      routeContext: "/performance",
      schedule: input.schedule,
      timezone: "UTC",
      organizationId: performance.organizationId,
      taskKind: BUSINESS_ANALYSIS_WATCH_TASK_KIND,
      taskConfig: freshConfig,
    });
    if (!result.success) {
      return { ok: false, error: result.error ?? "The watched question could not be scheduled." };
    }
    revalidatePath("/performance");
    return { ok: true, message: "Watched question scheduled with its accepted plan and evidence boundary." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The watched question could not be created." };
  }
}
