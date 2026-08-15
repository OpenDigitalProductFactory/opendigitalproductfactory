import { prisma } from "@dpf/db";

import {
  evaluateBusinessAnalysisWatch,
  parseBusinessAnalysisWatchConfig,
  type BusinessAnalysisWatchEvaluation,
  type BusinessAnalysisWatchConfig,
} from "./business-analysis-watch";
import { BUSINESS_ANALYSIS_WATCH_TASK_KIND } from "@/lib/operate/scheduled-jobs/agent-task-kind";
import { loadBusinessPerformance } from "./business-performance-provider";

export type BusinessAnalysisWatchView = {
  taskId: string;
  title: string;
  schedule: string;
  isActive: boolean;
  nextRunAt: string | null;
  config: BusinessAnalysisWatchConfig;
};

export async function listBusinessAnalysisWatchesFor(
  userId: string,
  organizationId: string,
): Promise<BusinessAnalysisWatchView[]> {
  const rows = await prisma.scheduledAgentTask.findMany({
    where: {
      ownerUserId: userId,
      organizationId,
      taskKind: BUSINESS_ANALYSIS_WATCH_TASK_KIND,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      taskId: true,
      title: true,
      schedule: true,
      isActive: true,
      nextRunAt: true,
      taskConfig: true,
    },
  });
  return rows.flatMap((row) => {
    try {
      return [{
        taskId: row.taskId,
        title: row.title,
        schedule: row.schedule,
        isActive: row.isActive,
        nextRunAt: row.nextRunAt?.toISOString() ?? null,
        config: parseBusinessAnalysisWatchConfig(row.taskConfig),
      }];
    } catch {
      return [];
    }
  });
}

export async function evaluateBusinessAnalysisWatchTask(
  task: {
    ownerUserId: string;
    organizationId: string | null;
    taskConfig: unknown;
  },
  deps: {
    loadPerformance?: typeof loadBusinessPerformance;
    now?: () => Date;
  } = {},
): Promise<{
  evaluation: BusinessAnalysisWatchEvaluation;
  nextConfig: BusinessAnalysisWatchConfig;
}> {
  if (!task.organizationId) {
    throw new Error("Business analysis watch has no organization scope.");
  }
  const config = parseBusinessAnalysisWatchConfig(task.taskConfig);
  const performance = await (deps.loadPerformance ?? loadBusinessPerformance)({
    userId: task.ownerUserId,
  });
  if (performance.status !== "ready" || performance.organizationId !== task.organizationId) {
    throw new Error("Business analysis watch organization no longer matches the owner's current organization.");
  }
  const metricKey = config.plan.metrics[0]!.key;
  const metric = performance.metricValues.find(({ key }) => key === metricKey);
  if (!metric) throw new Error("The watched metric is no longer in the current Performance pack.");
  return evaluateBusinessAnalysisWatch(config, {
    evaluatedAt: (deps.now ?? (() => new Date()))(),
    metric: {
      key: metric.key,
      availability: metric.availability,
      value: metric.value,
      sourceWatermark: metric.sourceWatermark,
    },
  });
}
