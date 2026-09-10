// apps/web/lib/tak/coworker-job-description.ts
//
// BI-5CCBF85B. Loading the job description of the coworker that is about to
// execute work.
//
// Every autonomous path — work threads, coworker requests, scheduled and self
// tasks, Workroom stage execution — composes its system prompt from
// `loadPromptBackplane`, which asked for `route-persona/<runtimeAgentId>`.
// Prompt templates are seeded with slug = FILE BASENAME and category =
// DIRECTORY, and no persona file's basename equals its agent id. 101 of 130
// selectable coworkers therefore missed, and silently received:
//
//   "You are <name>. Complete the assigned scheduled work with your granted
//    tools, prefer concrete action over narration, and finish with a concise
//    operational summary."
//
// That is a work instruction, not a job: no purpose, no accountability, no
// boundary, no peers. A coworker running on it infers its role from whatever
// task is in front of it.
//
// This module resolves the job description by the file's DECLARED agent id
// (see packages/db/src/persona-reachability.ts for why basename matching is
// unsafe), and makes a miss loud. A coworker executing without its job is a
// defect, and the platform has to be able to see it.

import { prisma } from "@dpf/db";
import {
  PERSONA_CATEGORIES,
  resolvePersonaTemplate,
  type PersonaTemplateIndexEntry,
} from "@dpf/db/persona-reachability";
import { loadPrompt } from "./prompt-loader";

/** Matches prompt-loader's TTL: the index and the prompts it points at expire together. */
const INDEX_TTL_MS = 60_000;

type IndexCache = { entries: PersonaTemplateIndexEntry[]; loadedAt: number };

let indexCache: IndexCache | null = null;

/**
 * Coworkers that executed without a job description this process, keyed by
 * canonical id. Read by the operational surface; never used to suppress the
 * log, because a recurring miss is a recurring defect.
 */
const unresolved = new Map<string, { attempts: number; lastAttempted: string[] }>();

/** Drop the cached index. Called when an admin edits a prompt template. */
export function invalidateJobDescriptionIndex(): void {
  indexCache = null;
}

/**
 * Coworkers seen executing without a job description since this process
 * started. Empty is the healthy state.
 */
export function unresolvedJobDescriptions(): Array<{
  canonicalAgentId: string;
  attempts: number;
  attempted: string[];
}> {
  return [...unresolved.entries()]
    .map(([canonicalAgentId, v]) => ({
      canonicalAgentId,
      attempts: v.attempts,
      attempted: v.lastAttempted,
    }))
    .sort((a, b) => a.canonicalAgentId.localeCompare(b.canonicalAgentId));
}

/**
 * Build the index of persona templates that declare a coworker identity.
 *
 * Two categories and fewer than a hundred rows, so this is one query held for
 * the cache lifetime rather than a lookup per resolution.
 */
export async function loadPersonaTemplateIndex(): Promise<PersonaTemplateIndexEntry[]> {
  if (indexCache && Date.now() - indexCache.loadedAt < INDEX_TTL_MS) {
    return indexCache.entries;
  }

  try {
    const rows = await prisma.promptTemplate.findMany({
      where: { category: { in: [...PERSONA_CATEGORIES] }, enabled: true },
      select: { category: true, slug: true, metadata: true },
    });

    type Row = { category: string; slug: string; metadata: unknown };
    const entries: PersonaTemplateIndexEntry[] = (rows as Row[]).map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : null;
      const declared = metadata?.agentId;
      return {
        category: row.category,
        slug: row.slug,
        declaredAgentId:
          typeof declared === "string" && declared.trim() ? declared.trim() : null,
      };
    });

    indexCache = { entries, loadedAt: Date.now() };
    return entries;
  } catch {
    // The database is unreachable. Return an empty index rather than throwing:
    // the caller falls back to its one-liner and the coworker still completes
    // the work in front of it. The miss is still recorded.
    return [];
  }
}

export interface JobDescriptionLoad {
  /** The job description, or the caller's fallback when none could be resolved. */
  content: string;
  resolved: boolean;
  /** Where it was found — `unresolved` when the fallback was used. */
  source: string;
  canonicalAgentId: string;
}

/**
 * Load the job description for the coworker identified by `agentIdOrSlug`.
 *
 * `fallbackContent` is returned when no job description can be resolved. It is
 * deliberately still returned — a coworker mid-run must be able to finish its
 * work rather than throw — but the miss is logged and counted so it cannot pass
 * unnoticed the way it has.
 */
export async function loadCoworkerJobDescription(
  agentIdOrSlug: string,
  fallbackContent: string,
): Promise<JobDescriptionLoad> {
  const index = await loadPersonaTemplateIndex();
  const resolution = resolvePersonaTemplate(agentIdOrSlug, index);

  if (resolution.ref) {
    const content = await loadPrompt(
      resolution.ref.category,
      resolution.ref.slug,
      fallbackContent,
    );
    if (content.trim()) {
      return {
        content,
        resolved: true,
        source: resolution.source,
        canonicalAgentId: resolution.canonicalAgentId,
      };
    }
  }

  recordUnresolved(resolution.canonicalAgentId, agentIdOrSlug, resolution.attempted);

  return {
    content: fallbackContent,
    resolved: false,
    source: "unresolved",
    canonicalAgentId: resolution.canonicalAgentId,
  };
}

/**
 * Make one value safe to put in a log line.
 *
 * The agent id reaching this module is caller-supplied — `request_coworker`
 * accepts one over an external token — so a crafted id containing newlines
 * could forge whole log entries and make a coworker appear to have resolved a
 * job it never received. Strip everything outside the identifier alphabet and
 * cap the length, so a hostile id shows up as visibly mangled rather than as
 * convincing extra lines. Reported by CodeQL on this file.
 */
function logSafe(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.:@+/-]/g, "?");
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}...` : cleaned;
}

function recordUnresolved(
  canonicalAgentId: string,
  requestedRef: string,
  attempted: string[],
): void {
  const prior = unresolved.get(canonicalAgentId);
  unresolved.set(canonicalAgentId, {
    attempts: (prior?.attempts ?? 0) + 1,
    lastAttempted: attempted,
  });

  console.warn(
    `[coworker_job_profile_unresolved] ${logSafe(canonicalAgentId)} executed with no job description. ` +
      `requested=${logSafe(requestedRef)} tried=${attempted.map(logSafe).join(", ")}. ` +
      `It will run on a generic work instruction: no purpose, accountability or boundary. ` +
      `See BI-5CCBF85B.`,
  );
}
