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
  prompt: string;            // extracted from skillMdContent body
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

/**
 * Extract the first-level prompt from a SKILL.md body.
 * Returns the first paragraph after the frontmatter heading,
 * or the description if no body content is available.
 */
function extractPromptFromBody(skillMdContent: string, description: string): string {
  // Strip frontmatter
  const match = skillMdContent.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  const body = match ? match[1].trim() : "";

  if (!body) return description;

  // Find the first non-heading, non-empty line(s) as the prompt
  const lines = body.split("\n");
  let prompt = "";
  let foundHeading = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      if (foundHeading) break; // Stop at second heading
      foundHeading = true;
      continue;
    }
    if (trimmed === "") {
      if (prompt) break; // Stop at first blank line after content
      continue;
    }
    prompt += (prompt ? " " : "") + trimmed;
  }

  return prompt || description;
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
      prompt: extractPromptFromBody(row.skill.skillMdContent, row.skill.description),
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
