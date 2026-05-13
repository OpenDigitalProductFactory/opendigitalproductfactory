"use server";

import { prisma } from "@dpf/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned to the UI — compatible with existing AgentSkill type. */
export interface CoworkerSkill {
  skillId: string;
  label: string;
  description: string;
  capability: string | null;
  prompt: string;            // compiled from the full skillMdContent body
  category: string;
  tags: string[];
  riskBand: string;
  taskType: string;
  triggerPattern: string | null;
  userInvocable: boolean;
  agentInvocable: boolean;
  allowedTools: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SkillPromptInput = {
  skillId: string;
  description: string;
  skillMdContent: string;
  taskType: string;
  allowedTools: string[];
};

function extractSkillBody(skillMdContent: string): string {
  const normalized = skillMdContent.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : normalized).trim();
}

function compileSkillInvocationPrompt(input: SkillPromptInput): string {
  const body = extractSkillBody(input.skillMdContent);
  const instructions = body || input.description;
  const prefix = input.taskType === "conversation" && input.allowedTools.length === 0
    ? ["This is a CONVERSATION request, not a tool request.", ""]
    : [];

  return [
    ...prefix,
    `Use the \`${input.skillId}\` skill.`,
    "",
    `Skill description: ${input.description}`,
    "",
    "Skill instructions:",
    instructions,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main query
// ---------------------------------------------------------------------------

/**
 * Load all active, enabled skills assigned to a specific coworker.
 * Returns them shaped for UI display (compatible with AgentSkill type).
 */
export async function getSkillsForAgent(agentId: string): Promise<CoworkerSkill[]> {
  try {
    const rows = await prisma.skillAssignment.findMany({
      where: {
        agentId,
        enabled: true,
        skill: {
          status: "active",
        },
      },
      orderBy: { priority: "desc" },
      include: {
        skill: true,
      },
    });

    return rows.map((row) => ({
      skillId: row.skill.skillId,
      label: row.skill.name,
      description: row.skill.description,
      capability: row.skill.capability,
      prompt: compileSkillInvocationPrompt({
        skillId: row.skill.skillId,
        description: row.skill.description,
        skillMdContent: row.skill.skillMdContent,
        taskType: row.skill.taskType,
        allowedTools: row.skill.allowedTools,
      }),
      category: row.skill.category,
      tags: row.skill.tags,
      riskBand: row.skill.riskBand,
      taskType: row.skill.taskType,
      triggerPattern: row.skill.triggerPattern,
      userInvocable: row.skill.userInvocable,
      agentInvocable: row.skill.agentInvocable,
      allowedTools: row.skill.allowedTools,
    }));
  } catch {
    // DB unavailable — return empty (caller will fall back to inline skills)
    return [];
  }
}

/**
 * Get all skills for an agent, shaped as legacy AgentSkill objects.
 * Used during transition — returns the same shape as ROUTE_AGENT_MAP skills.
 */
export async function getSkillsForAgentLegacy(agentId: string): Promise<
  Array<{ label: string; description: string; capability: string | null; prompt: string }>
> {
  const skills = await getSkillsForAgent(agentId);
  return skills
    .filter((s) => s.userInvocable)
    .map((s) => ({
      label: s.label,
      description: s.description,
      capability: s.capability,
      prompt: s.prompt,
    }));
}
