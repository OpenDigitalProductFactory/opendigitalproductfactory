// apps/web/lib/tak/agent-routing-server.ts
// Server-only async agent resolver that loads prompts and skills from DB.
// Wraps resolveAgentForRoute and replaces systemPrompt with DB version.
// Import this in server components / server actions — NOT in "use client" components.

import "server-only";
import {
  coworkerIdFromRecordRoute,
  resolveAgentForRoute,
} from "./agent-routing";
import { loadPrompt } from "./prompt-loader";
import { getSkillsForAgentLegacy } from "@/lib/actions/agent-skills";
import type { AgentInfo, AgentSkill } from "@/lib/agent-coworker-types";
import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import { resolveCoworkerIdentity } from "@/lib/coworker-identity";
import type { UserContext } from "@/lib/permissions";
import { withCoworkerInteractionContract } from "./coworker-interaction-contract";

async function loadPromptBackplane(agentId: string, fallbackPrompt: string): Promise<string> {
  const dbPrompt = await loadPrompt("route-persona", agentId, fallbackPrompt);
  const dbIdentity = await loadPrompt("platform-identity", "identity-block");
  const dbPreamble = await loadPrompt("platform-preamble", "platform-preamble");
  const dbMission = await loadPrompt("platform-mission", "company-mission");
  const preamble = [dbIdentity, dbMission, dbPreamble].filter(Boolean).join("\n\n");
  const prompt = preamble ? preamble + "\n\n" + dbPrompt : dbPrompt;
  return withCoworkerInteractionContract(prompt);
}

/**
 * Server-side agent resolver with DB-loaded prompts and skills.
 * Falls back to hardcoded prompts/skills if DB is unavailable.
 */
export async function resolveAgentForRouteWithPrompts(
  pathname: string,
  userContext: UserContext,
  useUnified?: boolean,
): Promise<AgentInfo> {
  const selectedCoworkerId = coworkerIdFromRecordRoute(pathname);
  if (selectedCoworkerId) {
    return resolveAgentByIdWithPrompts(selectedCoworkerId, userContext);
  }

  // Get the base agent info with hardcoded prompts and inline skills
  const agent = resolveAgentForRoute(pathname, userContext, useUnified);

  await ensureAgentPrincipalIdentity(agent.agentId);

  // Load DB-sourced skills (falls back to inline skills if DB is empty)
  const dbSkills = await getSkillsForAgentLegacy(agent.agentId);
  const skills: AgentSkill[] = dbSkills.length > 0
    ? dbSkills as AgentSkill[]
    : agent.skills; // Fallback to inline skills during transition

  // In unified mode, systemPrompt is empty (built by prompt-assembler)
  if (useUnified || !agent.systemPrompt) {
    return { ...agent, skills };
  }

  return {
    ...agent,
    skills,
    systemPrompt: await loadPromptBackplane(agent.agentId, agent.systemPrompt),
  };
}

export async function resolveAgentByIdWithPrompts(
  agentId: string,
  _userContext: UserContext,
): Promise<AgentInfo> {
  const identity = resolveCoworkerIdentity(agentId);
  const agentName = identity?.displayName ?? identity?.agentName ?? agentId;
  const fallbackPrompt = `You are ${agentName}. Complete the assigned scheduled work with your granted tools, prefer concrete action over narration, and finish with a concise operational summary.`;

  await ensureAgentPrincipalIdentity(agentId);

  const dbSkills = await getSkillsForAgentLegacy(agentId);
  const skills: AgentSkill[] = dbSkills as AgentSkill[];

  return {
    agentId,
    agentName,
    agentDescription: `${agentName} scheduled specialist`,
    canAssist: true,
    sensitivity: "internal",
    skills,
    systemPrompt: await loadPromptBackplane(agentId, fallbackPrompt),
  };
}
