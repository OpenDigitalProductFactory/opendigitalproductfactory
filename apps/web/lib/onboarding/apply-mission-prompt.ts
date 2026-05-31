// Persist the captured company mission into the global company-mission
// PromptTemplate (category=platform-mission, slug=company-mission). That row
// is injected as Block 0 of every coworker prompt (prompt-assembler.ts), so
// writing it here is what makes the mission visible to every coworker.
//
// PromptTemplate is global (no organizationId) — a DPF install is single-org,
// so the one global row IS the org's mission. Editable post-setup once
// platform-mission is in the prompt-admin catalog.

import { prisma } from "@dpf/db";
import { invalidatePromptCache } from "@/lib/tak/prompt-loader";

export const MISSION_PROMPT_CATEGORY = "platform-mission";
export const MISSION_PROMPT_SLUG = "company-mission";

/** Render the Block-0 mission content with the captured mission baked in. */
export function renderMissionPromptContent(mission: string): string {
  return [
    "COMPANY MISSION CONTEXT",
    "",
    "This section defines the overarching mission that governs all work — whether performed by humans or AI coworkers. Every action, recommendation, and decision should align with this mission.",
    "",
    `Mission: ${mission.trim()}`,
    "",
    "Values:",
    "- Quality over speed — deliver work that meets professional standards",
    "- Transparency — surface risks, trade-offs, and limitations honestly",
    "- Continuous improvement — every task is an opportunity to improve the platform and its processes",
    "- Human authority — AI coworkers augment human decision-making; humans retain final authority on all consequential decisions",
    "",
    "When making recommendations or taking actions, consider whether your work advances this mission. If a request conflicts with the company mission or values, flag the conflict transparently rather than proceeding silently.",
  ].join("\n");
}

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type ApplyMissionPromptClient = {
  promptTemplate: { upsert: (args: unknown) => Promise<unknown> };
};

export type ApplyMissionPromptInput = {
  mission: string | null | undefined;
  /** Defaults to the shared prisma client. */
  db?: ApplyMissionPromptClient;
  /** Invalidate the prompt cache after writing. Defaults to true. */
  invalidate?: boolean;
};

export type ApplyMissionPromptResult = { applied: boolean };

/**
 * Upsert the company-mission prompt from the captured mission. No-op when the
 * mission is blank (we never overwrite the editable default with emptiness).
 */
export async function applyMissionPrompt(
  input: ApplyMissionPromptInput,
): Promise<ApplyMissionPromptResult> {
  const mission = (input.mission ?? "").trim();
  if (mission.length === 0) return { applied: false };

  const db = input.db ?? (prisma as unknown as ApplyMissionPromptClient);
  const content = renderMissionPromptContent(mission);

  await db.promptTemplate.upsert({
    where: {
      category_slug: { category: MISSION_PROMPT_CATEGORY, slug: MISSION_PROMPT_SLUG },
    },
    update: {
      content,
      isOverridden: true,
      updatedBy: "setup",
    },
    create: {
      category: MISSION_PROMPT_CATEGORY,
      slug: MISSION_PROMPT_SLUG,
      name: "Company Mission",
      description:
        "Overarching company mission and values injected into every AI coworker's context",
      content,
      contentFormat: "markdown",
      isOverridden: true,
      updatedBy: "setup",
    },
  });

  if (input.invalidate !== false) {
    invalidatePromptCache(MISSION_PROMPT_CATEGORY, MISSION_PROMPT_SLUG);
  }

  return { applied: true };
}
