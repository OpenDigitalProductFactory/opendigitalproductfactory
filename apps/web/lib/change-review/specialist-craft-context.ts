// BI-39C7D449 — the pre-commit specialist lane consults its own craft.
//
// The lane already routes changed files to the right specialist
// (`selectSemanticReviewSpecialists`): .tsx to UX Accessibility, prisma/ to
// Data Governance, package.json to SBOM, architecture/ to the Architecture
// Guardrail. That part has worked for months. What it never did was let the
// specialist reason from its OWN profession corpus: each branch ran on a
// one-line persona string in SPECIALIST_SYSTEM_PROMPTS, so AGT-902 reviewed a
// migration without the data-governance corpus scoring it.
//
// THE MECHANICAL CAUSE. The registry binds a family to ROLE SLUGS
// (`ux-accessibility-agent`), and `findProfessionFamilyForAgentIdentity`
// documents the contract: "Registry-driven agents use AGT-* as Agent.agentId
// and their role slug as Agent.name." Every call site passed the agent id
// ALONE. No family claims the string "AGT-903", so resolution returned
// `missed-unmapped` and the corpus was never even looked up. Nothing logged a
// failure, because a miss is a legitimate outcome for an unmapped agent.
//
// So the fix is not registry surgery and not a hardcoded id-to-craft table in
// this module. It is to read the identity tuple the seed already persists and
// hand the resolver what it documented it needs. A specialist added later
// works with no change here, which a hardcoded table would not give us.
//
// Fail-open throughout: craft corpus is additive context for a reviewer, never
// a gate. A DB error, an unmapped agent or an empty corpus all return the base
// prompt unchanged, and the lane behaves exactly as it does today.

import {
  resolveProfessionCorpusContext,
  type ProfessionCorpusClient,
} from "@/lib/decision-perspective/profession-corpus";

/** The Agent identity tuple the registry resolves a family from. */
export type SpecialistAgentRow = {
  agentId: string;
  name: string | null;
  slugId: string | null;
};

/** Narrow client surface, so tests need neither Prisma nor a corpus fixture. */
export type SpecialistCraftClient = ProfessionCorpusClient & {
  agent: {
    findMany(args: {
      where: { agentId: { in: string[] } };
      select: { agentId: true; name: true; slugId: true };
    }): Promise<SpecialistAgentRow[]>;
  };
};

export type SpecialistCraftContext = {
  agentId: string;
  /** The craft that claimed this specialist, or null when unmapped. */
  professionKey: string | null;
  /** Why no corpus was injected, for the operator reading the log. */
  status: string;
  /** Pages actually layered into the branch prompt. */
  pages: number;
};

/**
 * Resolve each specialist's craft corpus in one DB round trip.
 *
 * Returns a map from agent id to the layered system prompt. An agent that
 * resolves to no family, or whose family has no applicable corpus, is simply
 * absent from the prompt map and present in `contexts` with the reason — the
 * caller then runs it on its base persona exactly as before.
 */
export async function resolveSpecialistCraftContexts(input: {
  db: SpecialistCraftClient;
  agentIds: readonly string[];
  /** The retrieval query — the change under review ranks the corpus pages. */
  query: string;
  maxPages?: number;
}): Promise<{ promptBlocks: Map<string, string>; contexts: SpecialistCraftContext[] }> {
  const agentIds = [...new Set(input.agentIds)].filter((id) => id.trim().length > 0);
  const promptBlocks = new Map<string, string>();
  const contexts: SpecialistCraftContext[] = [];
  if (agentIds.length === 0) return { promptBlocks, contexts };

  let rows: SpecialistAgentRow[];
  try {
    rows = await input.db.agent.findMany({
      where: { agentId: { in: [...agentIds] } },
      select: { agentId: true, name: true, slugId: true },
    });
  } catch {
    // Fail-open: every branch runs on its base persona, as it does today.
    return {
      promptBlocks,
      contexts: agentIds.map((agentId) => ({
        agentId,
        professionKey: null,
        status: "error-agent-read",
        pages: 0,
      })),
    };
  }

  const byId = new Map(rows.map((r) => [r.agentId, r]));

  for (const agentId of agentIds) {
    const row = byId.get(agentId);
    if (!row) {
      contexts.push({ agentId, professionKey: null, status: "missed-unknown-agent", pages: 0 });
      continue;
    }
    // The full tuple, not the id alone. Agent.name carries the role slug the
    // registry actually binds; passing the id alone is what made this lane
    // miss every time.
    const corpus = await resolveProfessionCorpusContext({
      db: input.db,
      identity: { agentId: row.agentId, name: row.name, slugId: row.slugId },
      query: input.query,
      ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
    }).catch(() => null);

    if (!corpus) {
      contexts.push({ agentId, professionKey: null, status: "error-corpus-read", pages: 0 });
      continue;
    }
    contexts.push({
      agentId,
      professionKey: corpus.professionKey,
      status: corpus.status,
      pages: corpus.promptBlock ? corpus.pages.length : 0,
    });
    if (corpus.promptBlock) promptBlocks.set(agentId, corpus.promptBlock);
  }

  return { promptBlocks, contexts };
}

/**
 * Layer a craft corpus onto a specialist's persona prompt.
 *
 * The persona still governs SCOPE — "review only accessibility risks" — and the
 * corpus supplies the doctrine that scope is judged against. Ordered persona
 * first so a corpus page cannot widen the branch beyond what it was dispatched
 * to review.
 */
export function layerCraftOntoSpecialistPrompt(
  basePrompt: string,
  promptBlock: string | undefined,
): string {
  return promptBlock ? `${basePrompt}\n\n${promptBlock}` : basePrompt;
}

/** One log line per review, so a silent miss stops being invisible. */
export function describeSpecialistCraftContexts(
  contexts: readonly SpecialistCraftContext[],
): string {
  if (contexts.length === 0) return "no specialist branches";
  return contexts
    .map((c) => `${c.agentId}→${c.professionKey ?? "unmapped"} (${c.status}, ${c.pages} page(s))`)
    .join("; ");
}
