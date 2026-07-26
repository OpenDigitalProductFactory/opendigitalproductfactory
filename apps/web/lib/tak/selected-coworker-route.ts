import { resolveAgentRoleLabel } from "@dpf/db/agent-identity";
import type { AgentInfo } from "@/lib/agent-coworker-types";
import { can, type UserContext } from "@/lib/permissions";

const COWORKER_RECORD_ROUTE_PREFIX = "/platform/ai/agent/";

export function coworkerIdFromRecordRoute(pathname: string): string | null {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith(COWORKER_RECORD_ROUTE_PREFIX)) return null;

  const encodedId = path.slice(COWORKER_RECORD_ROUTE_PREFIX.length);
  if (!encodedId || encodedId.includes("/")) return null;

  try {
    const agentId = decodeURIComponent(encodedId).trim();
    return /^[A-Za-z0-9_-]+$/.test(agentId) ? agentId : null;
  } catch {
    return null;
  }
}

export function resolveSelectedCoworkerForRoute(
  pathname: string,
  userContext: UserContext,
): AgentInfo | null {
  const agentId = coworkerIdFromRecordRoute(pathname);
  if (!agentId) return null;

  const agentName = resolveAgentRoleLabel(agentId);
  return {
    agentId,
    agentName,
    agentDescription: `Work with ${agentName}`,
    canAssist: can(userContext, "view_platform"),
    sensitivity: "internal",
    systemPrompt: "",
    skills: [],
    modelRequirements: {},
  };
}
