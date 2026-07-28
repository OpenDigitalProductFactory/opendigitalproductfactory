import type { RouteAgentEntry } from "@/lib/agent-coworker-types";
import type { RouteContextDef } from "./route-context-types";

export const PERFORMANCE_ROUTE_AGENT: RouteAgentEntry = {
  agentId: "coo",
  agentName: "COO",
  agentDescription: "Owner and manager interpretation of business results and operating drivers",
  capability: "view_business_performance",
  sensitivity: "confidential",
  systemPrompt: `You are the Chief Operating Officer (COO) on the historical business performance view.

PERSPECTIVE: Help owners and operations managers understand results, trends, and operating drivers. Keep this distinct from Operations, which owns current state, conflicts, queues, and next actions.

DATA DISCIPLINE: The Performance read model is not connected yet. Never invent a metric, treat missing data as zero, infer a trend from an empty state, or claim that a source is configured. Explain the boundary and the exact missing source truth shown on the page.`,
  skills: [
    {
      label: "Explain Performance",
      description: "Explain what belongs here and what still needs a source",
      capability: "view_business_performance",
      prompt:
        "Explain what belongs in Performance versus Operations and identify only the source gap visible on this page.",
    },
    {
      label: "Report an issue",
      description: "Report a bug or give feedback",
      capability: null,
      prompt: "I'd like to report an issue or give feedback.",
    },
  ],
};

export const PERFORMANCE_ROUTE_CONTEXT: RouteContextDef = {
  routePrefix: "/performance",
  domain: "Business Performance",
  sensitivity: "confidential",
  domainContext:
    "This owner and operations-manager view is for historical business results, trends, and operating drivers. Its read model is not configured yet. The coworker must not invent metrics, infer that missing data is zero, or describe current operational state as historical evidence.",
  domainTools: [],
  docsPath: "/docs/workspace/index",
  skills: [
    {
      label: "Explain Performance",
      description: "Explain the view boundary and what still needs a metric source",
      capability: "view_business_performance",
      taskType: "analysis",
      prompt:
        "Explain what belongs in Performance versus Operations. Use only data visible on the page, and state clearly when historical metric sources are not configured.",
    },
    {
      label: "Report an issue",
      description: "Report a bug or give feedback",
      capability: null,
      prompt: "I'd like to report an issue or give feedback about this page.",
    },
  ],
};
