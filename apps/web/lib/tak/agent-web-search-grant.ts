// Client-safe: registry JSON only. Do not import agent-grants.ts from client
// components — that module pulls server-only graphs (fs/net) into Turbopack.
import agentRegistryData from "../../../../packages/db/data/agent_registry.json";

type AgentEntry = {
  agent_id?: string;
  agent_name?: string;
  config_profile?: { tool_grants?: string[] };
};

const agents = (agentRegistryData as { agents: AgentEntry[] }).agents;

/**
 * Whether this coworker can ever use public web tools (`web_search` grant).
 * Session "Web access" is a no-op without it — UI must hide the switch (BI-CD9DC3BC).
 */
export function agentHoldsWebSearchGrant(agentId: string | null | undefined): boolean {
  if (!agentId) return false;
  const agent = agents.find((a) => a.agent_id === agentId || a.agent_name === agentId);
  const grants = agent?.config_profile?.tool_grants ?? [];
  return grants.includes("web_search");
}
