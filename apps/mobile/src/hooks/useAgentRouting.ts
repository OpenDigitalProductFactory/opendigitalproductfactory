import { usePathname } from "expo-router";

const ROUTE_AGENT_MAP: Record<string, string> = {
  "(tabs)": "workspace-guide",
  ops: "ops-coordinator",
  portfolio: "portfolio-advisor",
  customers: "customer-advisor",
  more: "workspace-guide",
};

/**
 * Maps the current Expo Router route to the appropriate specialist agent.
 * Falls back to "workspace-guide" for unknown routes.
 */
export function useAgentRouting(): string {
  const pathname = usePathname();

  // Match the first meaningful segment after the tabs group
  for (const [segment, agentId] of Object.entries(ROUTE_AGENT_MAP)) {
    if (pathname.includes(segment)) {
      return agentId;
    }
  }

  return "workspace-guide";
}
