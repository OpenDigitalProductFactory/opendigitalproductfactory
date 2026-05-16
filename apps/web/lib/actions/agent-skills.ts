"use server";

// Server-action surface for coworker skill loading. The actual skill runtime
// (parsing, compiling, querying, prompt blocks, invocation extraction) lives
// in `apps/web/lib/skills/runtime.ts` — this module exists to keep the
// existing `@/lib/actions/agent-skills` import sites stable while skill
// resolution lives in a focused, non-action module.

import {
  getSkillsForAgent as runtimeGetSkillsForAgent,
  getSkillsForAgentLegacy as runtimeGetSkillsForAgentLegacy,
  type CoworkerSkill,
} from "@/lib/skills/runtime";

// Type re-export removed: files marked "use server" may only export async
// functions in Next.js, so consumers should import CoworkerSkill from
// `@/lib/skills/runtime` directly. No current import sites referenced the
// re-export; verified via repo grep before removal.

export async function getSkillsForAgent(agentId: string): Promise<CoworkerSkill[]> {
  return runtimeGetSkillsForAgent(agentId);
}

export async function getSkillsForAgentLegacy(
  agentId: string,
): Promise<Array<{ label: string; description: string; capability: string | null; prompt: string }>> {
  return runtimeGetSkillsForAgentLegacy(agentId);
}
