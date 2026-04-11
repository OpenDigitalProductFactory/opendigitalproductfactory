// apps/web/lib/tak/agent-routing-server.ts
// Server-only async agent resolver that loads prompts and skills from DB.
// Wraps resolveAgentForRoute and replaces systemPrompt with DB version.
// Import this in server components / server actions — NOT in "use client" components.

import "server-only";
import { resolveAgentForRoute } from "./agent-routing";
import { loadPrompt } from "./prompt-loader";
import { getSkillsForAgentLegacy } from "@/lib/actions/agent-skills";
import type { AgentInfo, AgentSkill } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";

/**
 * Server-side agent resolver with DB-loaded prompts and skills.
 * Falls back to hardcoded prompts/skills if DB is unavailable.
 */
export async function resolveAgentForRouteWithPrompts(
  pathname: string,
  userContext: UserContext,
  useUnified?: boolean,
): Promise<AgentInfo> {
  // Get the base agent info with hardcoded prompts and inline skills
  const agent = resolveAgentForRoute(pathname, userContext, useUnified);

  // Load DB-sourced skills (falls back to inline skills if DB is empty)
  const dbSkills = await getSkillsForAgentLegacy(agent.agentId);
  const skills: AgentSkill[] = dbSkills.length > 0
    ? dbSkills as AgentSkill[]
    : agent.skills; // Fallback to inline skills during transition

  // In unified mode, systemPrompt is empty (built by prompt-assembler)
  if (useUnified || !agent.systemPrompt) {
    return { ...agent, skills };
  }

  // Load DB-powered prompt (falls back to the hardcoded one)
  const dbPrompt = await loadPrompt("route-persona", agent.agentId, agent.systemPrompt);
  const dbPreamble = await loadPrompt("platform-preamble", "platform-preamble");
  const dbMission = await loadPrompt("platform-mission", "company-mission");

  const preamble = [dbMission, dbPreamble].filter(Boolean).join("\n\n");

  return {
    ...agent,
    skills,
    systemPrompt: preamble ? preamble + "\n\n" + dbPrompt : dbPrompt,
  };
}
