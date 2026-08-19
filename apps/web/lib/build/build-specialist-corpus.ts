// A1 (BI-C654F960) Phase 2a — governed profession-corpus injection for build
// specialists, flag-gated default-off.
//
// THE CONVERGENCE STEP THIS IS. The build orchestrator runs each specialist on a
// hardcoded persona string (SPECIALIST_PROMPTS) and never injects the
// profession corpus — so the data-architecture practice corpus (BI-B31072B8),
// though published and retrievable, reaches only interactive chat, never a
// build. The correct fix (see the A1 investigation notes on BI-C654F960) is to
// GOVERN THE INLINE PATH: resolve the REAL specialist Agent's corpus and thread
// it into the same inline runAgenticLoop the build already runs — NOT to hand
// off via requestCoworker (an async CollaborationResult that cannot return the
// synchronous AgenticResult the build needs), and NOT to bake corpus into
// buildSpecialistPrompt as an end state (which would entrench the legacy plane).
//
// This is the FIRST governed increment: corpus injection keyed on the real Agent
// identity. Grant-based tool scoping, the DelegationChain hop, authority
// enforcement, and retiring SPECIALIST_PROMPTS are later phases.
//
// SAFETY: flag-gated default-off. With the flag off (the default) this returns
// the base prompt UNCHANGED, so the build path behaves EXACTLY as today and the
// legacy persona-string plane stays the active path. Fail-open: any resolve
// error returns the base unchanged — corpus is additive context, never a gate.

import { prisma } from "@dpf/db";
import {
  resolveProfessionCorpusContext,
  type ProfessionCorpusClient,
} from "@/lib/decision-perspective/profession-corpus";

/** Env flag that enables governed corpus injection into build specialists. */
export const BUILD_GOVERNED_SPECIALIST_CORPUS_FLAG = "BUILD_GOVERNED_SPECIALIST_CORPUS";

/** Default-off: only the exact string "true" enables it. */
export function governedSpecialistCorpusEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[BUILD_GOVERNED_SPECIALIST_CORPUS_FLAG] === "true";
}

export interface AppendGovernedCorpusResult {
  /** The system prompt to use — the base unchanged when disabled or on a miss. */
  prompt: string;
  /** Whether a corpus block was actually appended. */
  injected: boolean;
  /** Number of corpus pages injected (0 when not injected). */
  pages: number;
}

/**
 * Append the real specialist Agent's profession corpus to its inline system
 * prompt. Returns the base prompt unchanged when the flag is off, the agent maps
 * to no profession family, the corpus is empty, or resolution errors.
 */
export async function appendGovernedSpecialistCorpus(
  basePrompt: string,
  opts: {
    /** The specialist's real Agent id (SPECIALIST_AGENT_IDS[role]). */
    agentId: string;
    /** The retrieval query — the task at hand ranks the corpus pages. */
    query: string;
    /** Specialist role, for the injection log line. */
    role?: string;
    db?: ProfessionCorpusClient;
    env?: Record<string, string | undefined>;
  },
): Promise<AppendGovernedCorpusResult> {
  if (!governedSpecialistCorpusEnabled(opts.env)) {
    return { prompt: basePrompt, injected: false, pages: 0 };
  }
  const corpus = await resolveProfessionCorpusContext({
    db: opts.db ?? (prisma as unknown as ProfessionCorpusClient),
    identity: { agentId: opts.agentId },
    query: opts.query,
  }).catch((e) => {
    console.warn("[build-specialist-corpus] resolve failed (fail-open):", e);
    return null;
  });

  if (!corpus?.promptBlock) {
    return { prompt: basePrompt, injected: false, pages: 0 };
  }
  console.info(
    `[build-specialist] governed corpus injected for ${opts.role ?? "specialist"} (${opts.agentId}): ${corpus.pages.length} page(s)`,
  );
  return {
    prompt: `${basePrompt}\n\n${corpus.promptBlock}`,
    injected: true,
    pages: corpus.pages.length,
  };
}
