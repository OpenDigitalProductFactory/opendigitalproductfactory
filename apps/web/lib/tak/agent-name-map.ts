import type { RouteAgentEntry } from "@/lib/agent-coworker-types";

const HISTORICAL_AGENT_NAMES: Record<string, string> = {
  coworker: "Coworker",
  "marketing-specialist": "Marketing Strategist",
  "storefront-advisor": "Storefront Operations Manager",
  "doc-specialist": "Documentation Specialist",
  "data-architect": "Data Architect",
  "farm-ranch-steward": "Farm & Ranch Steward",
};

/** Build the synchronous client mirror while retaining names for historical turns. */
export function buildAgentNameMap(routeAgents: RouteAgentEntry[]): Record<string, string> {
  return {
    ...Object.fromEntries(routeAgents.map((agent) => [agent.agentId, agent.agentName])),
    ...HISTORICAL_AGENT_NAMES,
  };
}
