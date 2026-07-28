import { SCHEDULED_AGENT_TASK_KINDS } from "@/lib/operate/scheduled-jobs/agent-task-kind";

export const PRODUCT_INTELLIGENCE_WATCH_TASK_KIND =
  SCHEDULED_AGENT_TASK_KINDS[0];

export type ProductIntelligenceWatchConfig = {
  topic: string;
  query: string;
};

function cleanRequired(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Product intelligence watch ${label} is required.`);
  }
  return value.trim();
}

export function parseProductIntelligenceWatchConfig(
  value: unknown,
): ProductIntelligenceWatchConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Product intelligence watch configuration is missing.");
  }
  const record = value as Record<string, unknown>;
  return {
    topic: cleanRequired(record.topic, "topic"),
    query: cleanRequired(record.query, "query"),
  };
}
