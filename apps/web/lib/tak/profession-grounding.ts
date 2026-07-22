import "server-only";

import type { ProfessionCorpusContext } from "@/lib/decision-perspective/profession-corpus";

// BI-744D583B (EP-COMPETENCE-FLYWHEEL, knowledge pillar). Ground the AUTONOMOUS
// coworker execution path in profession (WSID) corpus.
//
// The interactive chat path (agent-coworker.ts) already resolves the corpus and
// injects it into its own prompt assembly. Every autonomous caller — spawned
// child threads (agent-thread-dispatcher-runtime), scheduled self-tasks
// (agent-task-scheduler), remote MCP task submission — flows through
// executeAutonomousAgenticLoop with a PRE-ASSEMBLED systemPrompt that never
// carried the corpus. So a build-lane coworker was bound to a profession family
// but did its actual work WITHOUT its craft knowledge, exactly when it matters
// most. This closes the read edge on that path.
//
// Mirrors the chat path (agent-coworker.ts:673-681, 1130-1131, 1187-1201):
//   • resolve family-scoped, install-variant-filtered corpus, fail-open;
//   • append the full promptBlock to the system prompt (the legacy-branch shape);
//   • fire the SAME ProfessionCorpusGap / ProfessionCorpusUsageStat evidence so
//     autonomous misses also feed the growth loop.
//
// The caller gates on interactionMode !== "chat" so chat is never double-injected.

/** Minimal identity the corpus resolver needs to map a coworker to a family. */
export interface ProfessionGroundingIdentity {
  agentId: string;
  slugId?: string | null;
  name?: string | null;
}

/**
 * Injectable dependency surface so the grounding logic is unit-testable without
 * a live DB. `defaultProfessionGroundingDeps` wires the real implementations via
 * dynamic import (avoiding a load-time cycle through the corpus + prisma stack).
 */
export interface ProfessionGroundingDeps {
  loadIdentity: (agentId: string) => Promise<ProfessionGroundingIdentity | null>;
  resolveInstallContext: () => Promise<Record<string, unknown>>;
  resolveCorpus: (input: {
    identity: ProfessionGroundingIdentity;
    query: string;
    installContext: Record<string, unknown>;
  }) => Promise<ProfessionCorpusContext | null>;
  recordEvidence: (input: {
    context: ProfessionCorpusContext;
    query: string;
    agentId: string;
    routeContext: string;
    promptInjected: boolean;
  }) => Promise<void>;
}

export interface ProfessionGroundingResult {
  /** The system prompt with the corpus block appended when one was injected. */
  systemPrompt: string;
  /** True when a corpus promptBlock was actually appended. */
  grounded: boolean;
}

/**
 * Resolve the coworker's profession corpus for the current query and append it
 * to the system prompt. Total and fail-open: any error returns the original
 * prompt unchanged (professional grounding must never break the run). Records
 * corpus evidence for BOTH hits and misses so the growth loop sees autonomous
 * demand — matching the chat path's `if (professionCorpus)` guard.
 */
export async function groundPromptWithProfessionCorpus(
  input: {
    systemPrompt: string;
    agentId: string;
    query: string;
    routeContext: string;
  },
  deps: ProfessionGroundingDeps,
): Promise<ProfessionGroundingResult> {
  const query = input.query?.trim() ?? "";
  if (!query || !input.agentId) {
    return { systemPrompt: input.systemPrompt, grounded: false };
  }

  try {
    const identity =
      (await deps.loadIdentity(input.agentId).catch(() => null)) ?? { agentId: input.agentId };
    const installContext = await deps.resolveInstallContext().catch(() => ({}));

    const context = await deps
      .resolveCorpus({ identity, query, installContext })
      .catch(() => null);
    if (!context) return { systemPrompt: input.systemPrompt, grounded: false };

    const grounded = Boolean(context.promptBlock);
    const systemPrompt = grounded
      ? `${input.systemPrompt}\n\n${context.promptBlock}`
      : input.systemPrompt;

    // Evidence for hits AND misses (the growth-loop signal). Fire-and-forget.
    void deps
      .recordEvidence({
        context,
        query,
        agentId: input.agentId,
        routeContext: input.routeContext,
        promptInjected: grounded,
      })
      .catch((e) =>
        console.warn("[profession-corpus] autonomous evidence record failed (fail-open):", e),
      );

    return { systemPrompt, grounded };
  } catch (e) {
    console.warn("[profession-corpus] autonomous grounding failed (fail-open):", e);
    return { systemPrompt: input.systemPrompt, grounded: false };
  }
}

/** Real dependency wiring (dynamic imports keep this off the module load path). */
export const defaultProfessionGroundingDeps: ProfessionGroundingDeps = {
  loadIdentity: async (agentId) => {
    const { prisma } = await import("@dpf/db");
    // Promise.resolve().then so a synchronous throw (partial prisma mock) becomes
    // a rejection the caller's .catch absorbs — identity lookup never breaks a run.
    return Promise.resolve()
      .then(() =>
        prisma.agent.findFirst({
          where: { agentId },
          select: { agentId: true, slugId: true, name: true },
        }),
      )
      .catch(() => null);
  },
  resolveInstallContext: async () => {
    const { prisma } = await import("@dpf/db");
    const { resolveInstallVariantContext } = await import(
      "@/lib/decision-perspective/install-variant-context"
    );
    return Promise.resolve()
      .then(() => resolveInstallVariantContext(prisma) as Promise<Record<string, unknown>>)
      .catch(() => ({}));
  },
  resolveCorpus: async ({ identity, query, installContext }) => {
    const { prisma } = await import("@dpf/db");
    const { resolveProfessionCorpusContext } = await import(
      "@/lib/decision-perspective/profession-corpus"
    );
    return resolveProfessionCorpusContext({
      db: prisma,
      identity,
      query,
      installContext,
    });
  },
  recordEvidence: async (args) => {
    const { recordProfessionCorpusEvidence } = await import(
      "@/lib/decision-perspective/profession-corpus-evidence"
    );
    await recordProfessionCorpusEvidence(args);
  },
};
