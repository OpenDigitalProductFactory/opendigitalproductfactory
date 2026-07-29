import type { getAiSpendOverview, listAiProviderFinanceProfiles } from "@/lib/finance/ai-provider-finance";

type Overview = Awaited<ReturnType<typeof getAiSpendOverview>>;
type Rows = Awaited<ReturnType<typeof listAiProviderFinanceProfiles>>;
type FinanceWorkItem = Rows[number]["financeWorkItems"][number];

type WorkItemMetadata = {
  providerName?: string;
  routeTarget?: string;
  financeRouteTarget?: string;
  suggestedQuestion?: string;
  missingFields: string[];
};

export type FinanceCoworkerAsk = {
  id: string;
  type: string;
  typeLabel: string;
  severity: string;
  severityLabel: string;
  title: string;
  providerName: string;
  question: string;
  missingFields: string[];
  routeTarget: string | null;
  coworkerPrompt: string;
};

export function humanizeFinanceLabel(value: string | null | undefined) {
  if (!value) return "None";
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter((item): item is string => Boolean(item))
    : [];
}

function internalRoute(value: unknown): string | null {
  const route = stringValue(value);
  if (!route || !route.startsWith("/") || route.startsWith("//")) return null;
  return route;
}

function workItemMetadata(workItem: FinanceWorkItem): WorkItemMetadata {
  const metadata = isRecord(workItem.metadata) ? workItem.metadata : {};

  return {
    providerName: stringValue(metadata.providerName),
    routeTarget: internalRoute(metadata.routeTarget) ?? undefined,
    financeRouteTarget: internalRoute(metadata.financeRouteTarget) ?? undefined,
    suggestedQuestion: stringValue(metadata.suggestedQuestion),
    missingFields: stringArray(metadata.missingFields),
  };
}

function buildAskPrompt(ask: Omit<FinanceCoworkerAsk, "coworkerPrompt">) {
  return [
    `Finance Specialist, resolve "${ask.title}" for ${ask.providerName}.`,
    `Ask an employee: ${ask.question}`,
    ask.missingFields.length > 0
      ? `Missing fields: ${ask.missingFields.map(humanizeFinanceLabel).join(", ")}.`
      : null,
    ask.routeTarget && ask.routeTarget !== "/finance/spend/ai"
      ? `Relevant setup route: ${ask.routeTarget}.`
      : null,
    "Use browser tools when credentials are available, and queue any remaining exact employee asks instead of accepting zero-cost placeholders.",
  ].filter(Boolean).join(" ");
}

export function buildFinanceCoworkerAsks(rows: Rows): FinanceCoworkerAsk[] {
  return rows.flatMap((row) =>
    row.financeWorkItems.map((workItem) => {
      const metadata = workItemMetadata(workItem);
      const providerName = metadata.providerName ?? row.provider.name;
      const title = workItem.title || `Resolve ${humanizeFinanceLabel(workItem.type)} for ${providerName}`;
      const question = metadata.suggestedQuestion
        ?? workItem.description
        ?? `What cost, renewal, billing owner, and payment evidence should Finance track for ${providerName}?`;
      const routeTarget = metadata.routeTarget ?? metadata.financeRouteTarget ?? null;
      const ask = {
        id: workItem.id,
        type: workItem.type,
        typeLabel: humanizeFinanceLabel(workItem.type),
        severity: workItem.severity ?? "medium",
        severityLabel: humanizeFinanceLabel(workItem.severity ?? "medium"),
        title,
        providerName,
        question,
        missingFields: metadata.missingFields,
        routeTarget,
      };

      return {
        ...ask,
        coworkerPrompt: buildAskPrompt(ask),
      };
    }),
  );
}

export function buildTraceabilityPrompt(overview: Overview, traceabilityGapCount: number, visibleAskCount: number) {
  return [
    "Finance Specialist, triage the AI spend traceability gaps on /finance/spend/ai.",
    `${traceabilityGapCount} gaps are visible across ${overview.untrackedProviderCount} unpriced active providers, ${overview.contractsNeedingSetup} draft finance setups, and ${overview.openWorkItems} queued human asks.`,
    visibleAskCount > 0
      ? "Start with the listed employee asks and use browser retrieval where credentials or scoped profiles are available."
      : "Identify the next exact employee ask required to close the missing AI provider cost data.",
    "Do not treat $0 spend as healthy while provider subscription or billing details are unknown.",
  ].join(" ");
}
