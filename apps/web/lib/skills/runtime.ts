// Skill runtime service for the governed Hermes-style learning loop.
//
// Owns:
//   - parsing SKILL.md frontmatter and body,
//   - compiling the invocation prompt used by AgentSkillsDropdown,
//   - loading DB-backed CoworkerSkill rows for a given coworker,
//   - extracting the active skill id from a compiled prompt,
//   - rendering a concise prompt block the prompt-assembler can splice in.
//
// Server-only — uses the Prisma client. The existing `agent-skills.ts`
// server-action module re-exports the loader functions so its public
// API stays stable while skill resolution lives here.

import { prisma } from "@dpf/db";

/** Shape returned to the UI — compatible with existing AgentSkill type. */
export interface CoworkerSkill {
  skillId: string;
  label: string;
  description: string;
  capability: string | null;
  prompt: string;
  category: string;
  tags: string[];
  riskBand: string;
  taskType: string;
  triggerPattern: string | null;
  userInvocable: boolean;
  agentInvocable: boolean;
  allowedTools: string[];
}

type SkillPromptInput = {
  skillId: string;
  description: string;
  skillMdContent: string;
  taskType: string;
  allowedTools: string[];
};

export function extractSkillBody(skillMdContent: string): string {
  const normalized = skillMdContent.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : normalized).trim();
}

export function compileSkillInvocationPrompt(input: SkillPromptInput): string {
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

/**
 * Load all active, enabled skills assigned to a specific coworker. Returns
 * them shaped for UI display (compatible with AgentSkill type).
 */
export async function getSkillsForAgent(agentId: string): Promise<CoworkerSkill[]> {
  try {
    const rows = await prisma.skillAssignment.findMany({
      where: {
        agentId,
        enabled: true,
        skill: { status: "active" },
      },
      orderBy: { priority: "desc" },
      include: { skill: true },
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

/**
 * Read the skill id off the compiled invocation prompt. The user-facing
 * skill click renders `Use the \`<skill-id>\` skill.` as the first line of
 * the model-visible content (see compileSkillInvocationPrompt above), so the
 * coworker chat path can recover the active skill id from the user message
 * without changing the existing skill-dropdown contract.
 *
 * Returns null for ordinary conversational input. Conversation-mode skills
 * prepend an extra disclaimer line, so the regex tolerates leading prefix
 * lines.
 */
export function extractInvokedSkillId(content: string): string | null {
  const match = content.match(/(?:^|\n)Use the `([^`]+)` skill\./);
  return match?.[1] ?? null;
}

/** Compact, prompt-side summary of a coworker's eligible skills. */
export type SkillSummaryForPrompt = {
  skillId: string;
  label: string;
  description: string;
};

/**
 * Render the eligible-skills block the prompt-assembler splices into the
 * domain block. Returns an empty string when no skills are eligible so
 * callers can concatenate without conditional joining.
 */
export function renderSkillsPromptBlock(skills: SkillSummaryForPrompt[]): string {
  if (skills.length === 0) return "";
  return [
    "Available coworker skills:",
    ...skills.map((s) => `- ${s.skillId}: ${s.label} - ${s.description}`),
  ].join("\n");
}

/** Project a CoworkerSkill[] down to the prompt-summary shape. */
export function toSkillSummariesForPrompt(skills: CoworkerSkill[]): SkillSummaryForPrompt[] {
  return skills.map((s) => ({
    skillId: s.skillId,
    label: s.label,
    description: s.description,
  }));
}
