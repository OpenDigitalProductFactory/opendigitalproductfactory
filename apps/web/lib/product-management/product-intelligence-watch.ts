import {
  scheduleAgentTaskFor,
  type ScheduleAgentTaskInput,
  type ScheduleAgentTaskResult,
} from "@/lib/operate/scheduled-jobs/agent-task-core";
import {
  proposeResearch,
  type ProposeResearchInput,
  type ProposeResearchResult,
} from "@/lib/wiki/research-proposal";
import {
  PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
  parseProductIntelligenceWatchConfig,
} from "./product-intelligence-watch-contract";
import { queueProductManagementPlaybookRefreshBestEffort } from "./product-management-playbook-refresh";

export { PRODUCT_INTELLIGENCE_WATCH_TASK_KIND };

export type CreateProductIntelligenceWatchInput = {
  ownerUserId: string;
  organizationId: string;
  productLineId?: string | null;
  businessProductId?: string | null;
  title: string;
  topic: string;
  query: string;
  schedule: string;
};

export type ProductIntelligenceWatchTask = {
  taskKind: string | null;
  organizationId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  taskConfig: unknown;
};

function cleanRequired(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Product intelligence watch ${label} is required.`);
  }
  return value.trim();
}

function routeForWatch(input: CreateProductIntelligenceWatchInput): string {
  if (input.businessProductId) {
    return `/portfolio/product/${encodeURIComponent(input.businessProductId)}/direction/intelligence`;
  }
  if (input.productLineId) {
    return `/portfolio/product-line/${encodeURIComponent(input.productLineId)}/direction`;
  }
  return "/portfolio";
}

export async function createProductIntelligenceWatch(
  input: CreateProductIntelligenceWatchInput,
  deps: {
    schedule?: (
      userId: string,
      input: ScheduleAgentTaskInput,
    ) => Promise<ScheduleAgentTaskResult>;
  } = {},
): Promise<ScheduleAgentTaskResult> {
  const topic = cleanRequired(input.topic, "topic");
  const query = cleanRequired(input.query, "query");
  const schedule = deps.schedule ?? scheduleAgentTaskFor;
  return schedule(input.ownerUserId, {
    agentId: "marketing-specialist",
    title: cleanRequired(input.title, "title"),
    prompt:
      "Create a pending product-intelligence research proposal for operator review. Do not execute web research or publish knowledge.",
    routeContext: routeForWatch(input),
    schedule: input.schedule,
    timezone: "UTC",
    organizationId: input.organizationId,
    productLineId: input.productLineId ?? null,
    businessProductId: input.businessProductId ?? null,
    taskKind: PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
    taskConfig: { topic, query },
  });
}

export async function proposeProductIntelligenceWatch(
  task: ProductIntelligenceWatchTask,
  deps: {
    propose?: (
      input: ProposeResearchInput,
    ) => Promise<ProposeResearchResult>;
    refresh?: typeof queueProductManagementPlaybookRefreshBestEffort;
  } = {},
): Promise<ProposeResearchResult> {
  if (task.taskKind !== PRODUCT_INTELLIGENCE_WATCH_TASK_KIND) {
    throw new Error("Scheduled task is not a product intelligence watch.");
  }
  const organizationId = cleanRequired(task.organizationId, "organization");
  const config = parseProductIntelligenceWatchConfig(task.taskConfig);
  const propose = deps.propose ?? ((input) => proposeResearch(input));
  const result = await propose({
    organizationId,
    productLineId: task.productLineId,
    businessProductId: task.businessProductId,
    topic: config.topic,
    query: config.query,
    proposedBy: "schedule",
  });
  if (result.created) {
    await (deps.refresh ?? queueProductManagementPlaybookRefreshBestEffort)({
      organizationId,
      productLineId: task.productLineId,
      businessProductId: task.businessProductId,
      sourceKind: "research-proposal",
      sourceId: result.proposalId,
      changedAt: new Date(),
    });
  }
  return result;
}
