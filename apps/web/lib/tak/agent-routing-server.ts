// apps/web/lib/tak/agent-routing-server.ts
// Server-only async agent resolver that loads prompts and skills from DB.
// Wraps resolveAgentForRoute and replaces systemPrompt with DB version.
// Import this in server components / server actions — NOT in "use client" components.

import "server-only";
import { prisma } from "@dpf/db";
import { resolveAgentForRoute } from "./agent-routing";
import { coworkerIdFromRecordRoute } from "./selected-coworker-route";
import { loadPrompt } from "./prompt-loader";
import { getSkillsForAgentLegacy } from "@/lib/actions/agent-skills";
import type { AgentInfo, AgentSkill } from "@/lib/agent-coworker-types";
import { ensureAgentPrincipalIdentity } from "@/lib/identity/principal-linking";
import { can, type UserContext } from "@/lib/permissions";
import { evaluateLifecycleGate } from "@/lib/coworker-lifecycle/lifecycle-gate";
import { withCoworkerInteractionContract } from "./coworker-interaction-contract";
import {
  SELECTABLE_COWORKER_STATE,
  selectableCoworkerIdentityRefs,
} from "@/lib/coworker-record/selectable-coworker";

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
  userContext: UserContext,
): Promise<AgentInfo> {
  if (!can(userContext, "view_platform")) {
    return unavailableAgent(agentId);
  }

  const { canonicalAgentId, runtimeAgentId } =
    selectableCoworkerIdentityRefs(agentId);
  const selected = await prisma.agent.findFirst({
    where: {
      agentId: canonicalAgentId,
      ...SELECTABLE_COWORKER_STATE,
    },
    select: {
      agentId: true,
      slugId: true,
      displayName: true,
      name: true,
      description: true,
      sensitivity: true,
    },
  });
  if (!selected) {
    return unavailableAgent(agentId);
  }

  const runtime = await prisma.agent.findFirst({
    where: {
      agentId: runtimeAgentId,
      ...SELECTABLE_COWORKER_STATE,
    },
    select: {
      agentId: true,
      displayName: true,
      name: true,
      description: true,
      sensitivity: true,
    },
  });
  if (!runtime) {
    return unavailableAgent(agentId);
  }

  const gate = await evaluateLifecycleGate(runtime.agentId, {
    purpose: "chat",
  });
  if (!gate.allowed) {
    return unavailableAgent(agentId);
  }

  const agentName =
    selected.displayName ||
    selected.name ||
    runtime.displayName ||
    runtime.name ||
    runtimeAgentId;
  const fallbackPrompt = `You are ${agentName}. Complete the assigned scheduled work with your granted tools, prefer concrete action over narration, and finish with a concise operational summary.`;

  await ensureAgentPrincipalIdentity(runtimeAgentId);

  const dbSkills = await getSkillsForAgentLegacy(runtimeAgentId);
  const skills: AgentSkill[] = dbSkills as AgentSkill[];

  return {
    agentId: runtimeAgentId,
    agentName,
    agentDescription:
      selected.description?.trim() ||
      runtime.description?.trim() ||
      `${agentName} scheduled specialist`,
    canAssist: true,
    sensitivity: normalizeSensitivity(
      selected.sensitivity ?? runtime.sensitivity,
    ),
    skills,
    systemPrompt: await loadPromptBackplane(runtimeAgentId, fallbackPrompt),
  };
}

function unavailableAgent(agentId: string): AgentInfo {
  return {
    agentId,
    agentName: "Coworker unavailable",
    agentDescription:
      "This coworker is unavailable or you do not have permission to use it.",
    canAssist: false,
    sensitivity: "internal",
    skills: [],
    systemPrompt: "",
  };
}

function normalizeSensitivity(
  value: string | null | undefined,
): AgentInfo["sensitivity"] {
  if (
    value === "public" ||
    value === "confidential" ||
    value === "restricted"
  ) {
    return value;
  }
  return "internal";
}
