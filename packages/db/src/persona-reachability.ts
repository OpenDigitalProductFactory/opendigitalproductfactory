// packages/db/src/persona-reachability.ts
//
// BI-5CCBF85B. Resolving a coworker's job description to the persona file that
// actually holds it.
//
// The defect this exists to fix: the runtime asked for
// `loadPrompt("route-persona", runtimeAgentId)` while prompt templates are
// seeded with slug = FILE BASENAME and category = DIRECTORY. Zero of the 91
// persona files have `slug == agent_id` — every one is named
// `policy-enforcement-agent` while declaring `agent_id: AGT-100` — and 60 of
// them live under the `specialist` category the lookup never queried. 101 of
// 130 selectable coworkers therefore executed on a generated one-liner instead
// of the job description that was authored, reviewed and CI-checked for them.
//
// The authoritative key is the file's DECLARED agent id, not its basename.
// `audit-coworker-personas.ts` already validates that every declared id
// resolves to a registry agent (PERSONA-001/002), so an index keyed on it is
// total by construction for any file the audit accepts.
//
// Slug matching is deliberately NOT applied across categories. It is ambiguous:
// `prompts/specialist/data-architect.prompt.md` declares `AGT-BUILD-DA`, while
// the identity bridge maps the slug `data-architect` to
// `AGT-WS-DATA-ARCHITECT`. Matching on basename alone would hand a coworker
// another coworker's job description — a worse failure than the fallback,
// because it is silent and plausible. Slug matching survives only within
// `route-persona`, where it reproduces the pre-fix behaviour exactly.
//
// This module is pure: it takes an index and returns a resolution. The runtime
// builds the index from PromptTemplate rows; the audit builds it from files on
// disk. One implementation of "which file holds this coworker's job", so the
// gate can assert what the runtime actually does rather than what a file
// declares. That divergence is how the defect went unseen while the persona
// audit reported zero errors.

import {
  CANONICAL_AGENT_ID_TO_COWORKER_SLUG,
  resolveCanonicalAgentId,
} from "./agent-identity.js";

/**
 * Prompt categories that can hold a coworker job description, in preference
 * order. `route-persona` first: it is the surface persona and the category the
 * pre-fix lookup used, so preferring it keeps every already-resolving coworker
 * on the exact file it resolved to before.
 */
export const PERSONA_CATEGORIES = ["route-persona", "specialist"] as const;

export type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

export interface PersonaTemplateRef {
  category: string;
  slug: string;
}

export interface PersonaTemplateIndexEntry extends PersonaTemplateRef {
  /**
   * The `agent_id` declared in the file's frontmatter, canonicalized. Null for
   * prompts that are not a coworker job description (shared includes, build
   * phases) and for rows seeded before this field was persisted.
   */
  declaredAgentId: string | null;
}

/**
 * How the job description was found. Recorded on the resolution so an operator
 * can tell a first-class match from a compatibility fallback, and so the
 * unresolved signal can say what was tried.
 */
export type PersonaResolutionSource =
  | "declared-agent-id"
  | "route-persona-slug"
  | "identity-bridge-slug"
  | "unresolved";

export interface PersonaResolution {
  /** The persona template to load, or null when the coworker has no job description. */
  ref: PersonaTemplateRef | null;
  source: PersonaResolutionSource;
  /** The canonical identity the lookup was performed for. */
  canonicalAgentId: string;
  /** Probes attempted, as `category/slug`, for the unresolved diagnostic. */
  attempted: string[];
}

function categoryRank(category: string): number {
  const index = (PERSONA_CATEGORIES as readonly string[]).indexOf(category);
  return index === -1 ? PERSONA_CATEGORIES.length : index;
}

/**
 * Deterministic ordering so a duplicate declaration can never resolve to a
 * different file between two runs: preferred category first, then slug.
 */
function compareEntries(
  a: PersonaTemplateIndexEntry,
  b: PersonaTemplateIndexEntry,
): number {
  const byCategory = categoryRank(a.category) - categoryRank(b.category);
  if (byCategory !== 0) return byCategory;
  return a.slug.localeCompare(b.slug);
}

/**
 * Resolve the persona template holding this coworker's job description.
 *
 * `agentIdOrSlug` is whatever the runtime holds — a canonical `AGT-*` id or a
 * dual-seeded slug row. Both are canonicalized before matching.
 */
export function resolvePersonaTemplate(
  agentIdOrSlug: string,
  index: readonly PersonaTemplateIndexEntry[],
): PersonaResolution {
  const canonicalAgentId = resolveCanonicalAgentId(agentIdOrSlug);
  const attempted: string[] = [];

  // 1. Declared agent id. The authoritative key, and the only one that reaches
  //    a persona under the `specialist` category.
  attempted.push(`declared-agent-id:${canonicalAgentId}`);
  const declared = index
    .filter((entry) => entry.declaredAgentId === canonicalAgentId)
    .sort(compareEntries);
  const firstDeclared = declared[0];
  if (firstDeclared) {
    return {
      ref: { category: firstDeclared.category, slug: firstDeclared.slug },
      source: "declared-agent-id",
      canonicalAgentId,
      attempted,
    };
  }

  // 2. The pre-fix lookup, kept so a row whose declared id was never persisted
  //    (an admin-overridden template) resolves exactly as it did before.
  const bySlug = (slug: string): PersonaTemplateIndexEntry | undefined => {
    attempted.push(`route-persona/${slug}`);
    return index.find(
      (entry) => entry.category === "route-persona" && entry.slug === slug,
    );
  };

  const rawMatch = bySlug(agentIdOrSlug);
  if (rawMatch) {
    return {
      ref: { category: rawMatch.category, slug: rawMatch.slug },
      source: "route-persona-slug",
      canonicalAgentId,
      attempted,
    };
  }

  // 3. The hand-maintained identity bridge, for a canonical id whose persona
  //    file is named for its slug and carries no declared id.
  const bridgeSlug = CANONICAL_AGENT_ID_TO_COWORKER_SLUG[canonicalAgentId];
  if (bridgeSlug && bridgeSlug !== agentIdOrSlug) {
    const bridgeMatch = bySlug(bridgeSlug);
    if (bridgeMatch) {
      return {
        ref: { category: bridgeMatch.category, slug: bridgeMatch.slug },
        source: "identity-bridge-slug",
        canonicalAgentId,
        attempted,
      };
    }
  }

  return { ref: null, source: "unresolved", canonicalAgentId, attempted };
}

/**
 * Declared ids claimed by more than one persona file. `resolvePersonaTemplate`
 * stays deterministic in their presence, but a duplicate means two files claim
 * to be the same coworker's job description and one of them is dead — a defect
 * the audit reports rather than tolerating silently.
 */
export function findDuplicateDeclarations(
  index: readonly PersonaTemplateIndexEntry[],
): Array<{ declaredAgentId: string; refs: PersonaTemplateRef[] }> {
  const byId = new Map<string, PersonaTemplateIndexEntry[]>();
  for (const entry of index) {
    if (!entry.declaredAgentId) continue;
    const bucket = byId.get(entry.declaredAgentId);
    if (bucket) bucket.push(entry);
    else byId.set(entry.declaredAgentId, [entry]);
  }
  const duplicates: Array<{ declaredAgentId: string; refs: PersonaTemplateRef[] }> = [];
  for (const [declaredAgentId, entries] of byId) {
    if (entries.length < 2) continue;
    duplicates.push({
      declaredAgentId,
      refs: [...entries]
        .sort(compareEntries)
        .map((entry) => ({ category: entry.category, slug: entry.slug })),
    });
  }
  return duplicates.sort((a, b) =>
    a.declaredAgentId.localeCompare(b.declaredAgentId),
  );
}
