// Phase 2 Task 2.2 of the principles-as-wiki-kind plan:
// recallPrincipleContext — Postgres-first commandment retrieval + Qdrant
// relevance for core + threshold-gated contextual retrieval, formatted as
// a distinct Governance Principles block so the prompt assembler can
// split governance from background wiki context.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §12.1
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 2 Task 2.2)

import {
  PRINCIPLE_DECIDE_DEFAULTS,
  listPrinciplesByTier,
  prisma,
} from "@dpf/db";
import type { PrincipleRingScope } from "@dpf/db/wiki-taxonomy";

import { searchWikiPages, type WikiSearchResult } from "./embeddings";
import { principleMatchesRingScope } from "./calling-ring-map";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PrincipleAppliesToPopulation =
  | "in_platform_coworker"
  | "external_coding_agent"
  | "human";

export type RecallPrincipleContextInput = {
  /** The user message or query, embedded against the wiki-pages collection. */
  query: string;
  /** Tenant context. Pass `null` for kernel-only retrieval (admin / public surfaces). */
  organizationId: string | null;
  /** Population whose principles should apply — filters by principleAppliesTo. */
  callingPopulation: PrincipleAppliesToPopulation;
  /** Top-K relevant core principles to surface from Qdrant. Default 5. */
  coreLimit?: number;
  /** Similarity threshold for contextual principles (cosine). Default 0.75. */
  contextualSimilarityThreshold?: number;
  /** Top-K contextual principles to surface above threshold. Default 5. */
  contextualLimit?: number;
  /**
   * Ring scope of the calling action (BI-4AA1074B Slice 2; spec §5.2).
   *
   * When provided, retrieval filters principles to those whose
   * `principleRingScope` intersects the caller scope OR contains
   * `universal-ring` OR is empty. Pass `["universal-ring"]` (or omit) for
   * unconstrained consultation — useful for design-time / kernel-
   * architecture decisions that genuinely bind every ring.
   *
   * Defaults can be resolved from a calling-surface name via
   * `resolveCallerRingScope` in `./calling-ring-map`.
   */
  ringScope?: PrincipleRingScope[];
  /**
   * Optional calling-surface label propagated into the
   * `[principle-recall-trace]` log line. Helps the operator correlate
   * recall traffic with the surface that drove it. Free-form string.
   */
  callingSurface?: string;
};

/**
 * The shape of a Postgres-returned commandment row used by the formatter.
 * Mirrors the columns selected by listPrinciplesByTier. Loose typing
 * because the underlying Prisma return is `unknown[]` for testability.
 */
export type RecalledCommandment = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  principleTier: string;
  principleDirection: string | null;
  principleAppliesTo: string[];
  /**
   * Ring scope (BI-4AA1074B Slice 2). Populated when the row carries explicit
   * scope. Empty array for un-backfilled rows; recall treats empty as
   * "passes any caller scope" for backward compatibility.
   */
  principleRingScope?: string[];
  isKernel: boolean;
  organizationId: string | null;
};

export type RecallPrincipleContextResult = {
  /** Pre-formatted prompt block (or null when there's nothing to inject). */
  block: string;
  commandments: RecalledCommandment[];
  core: WikiSearchResult[];
  contextual: WikiSearchResult[];
  /**
   * Counts of principles excluded by the ring-scope filter at each tier.
   * Surfaced in `[principle-recall-trace]` so the operator can spot
   * over-tight scoping (zero recall when something was expected) and
   * under-tight scoping (huge excluded counts on every call). Zero across
   * the board when `ringScope` was unset or `universal-ring`.
   */
  ringScopeExcluded?: {
    commandments: number;
    core: number;
    contextual: number;
  };
};

// ─── Hard caps ──────────────────────────────────────────────────────────────

/**
 * Defensive prompt-budget cap on commandments per recall. Originally mirrored
 * the governance cap of 10 (since removed 2026-05-22 — see
 * `docs/superpowers/plans/2026-05-22-principle-scope-refactor.md`). Now that
 * commandments are uncapped at the governance layer, this constant is
 * justified solely on prompt-token grounds: even with the strict consumer-
 * context filter in `recallPrincipleContext`, the cap protects against a
 * misseeded corpus dumping unbounded commandment text into a single prompt.
 *
 * Tune upward only if real usage shows commandments getting clipped in
 * legitimate scenarios; the right answer is usually finer context scoping,
 * not a higher cap.
 */
const COMMANDMENT_RETRIEVAL_CAP = 10;
const DEFAULT_CORE_LIMIT = 5;
const DEFAULT_CONTEXTUAL_LIMIT = 5;

// ─── Pure formatter ─────────────────────────────────────────────────────────

/**
 * Render the three tier arrays as a single prompt context block. Returns
 * `null` when every tier is empty so callers can drop the block entirely
 * instead of injecting an empty governance header.
 *
 * The block uses an unambiguous `GOVERNANCE PRINCIPLES` header so the
 * prompt assembler can distinguish governance from ordinary wiki context
 * (which uses `RELEVANT WIKI CONTEXT`). Empty tier sections are omitted
 * to keep the block compact.
 */
export function formatPrincipleContext(input: {
  commandments: RecalledCommandment[];
  core: WikiSearchResult[];
  contextual: WikiSearchResult[];
}): string | null {
  if (
    input.commandments.length === 0 &&
    input.core.length === 0 &&
    input.contextual.length === 0
  ) {
    return null;
  }

  const sections: string[] = [];

  if (input.commandments.length > 0) {
    const lines = input.commandments.map((c) => {
      const dir = c.principleDirection?.trim() || "(no direction)";
      return `- ${c.title} (${c.slug}) — ${dir}`;
    });
    sections.push(`Commandments (${input.commandments.length}):\n${lines.join("\n")}`);
  }

  if (input.core.length > 0) {
    const lines = input.core.map((r) => {
      const preview = (r.contentPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      return `- ${r.title} (${r.slug}) — ${preview}`;
    });
    sections.push(`Core (${input.core.length}):\n${lines.join("\n")}`);
  }

  if (input.contextual.length > 0) {
    const lines = input.contextual.map((r) => {
      const preview = (r.contentPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      return `- ${r.title} (${r.slug}) — ${preview}`;
    });
    sections.push(`Contextual (${input.contextual.length}):\n${lines.join("\n")}`);
  }

  return `GOVERNANCE PRINCIPLES:\n${sections.join("\n\n")}`;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Retrieve governance principles relevant to a query + calling population.
 *
 * Per spec §12.1:
 * 1. Always inject in-scope commandments from Postgres (cap 10).
 *    Independent of Qdrant — commandments still come back if Qdrant is down.
 * 2. Top-K relevant core principles from Qdrant (default 5). Silently
 *    empty on Qdrant failure.
 * 3. Contextual principles only above similarity threshold (default 0.75).
 *    Same silent-degradation as core.
 *
 * Returns `null` when every branch is empty so callers can drop the
 * Governance Principles block from the system prompt.
 */
export async function recallPrincipleContext(
  input: RecallPrincipleContextInput,
): Promise<RecallPrincipleContextResult | null> {
  const coreLimit = input.coreLimit ?? DEFAULT_CORE_LIMIT;
  const contextualLimit = input.contextualLimit ?? DEFAULT_CONTEXTUAL_LIMIT;
  const contextualThreshold =
    input.contextualSimilarityThreshold ??
    PRINCIPLE_DECIDE_DEFAULTS.contextualSimilarityThreshold;

  // Ring-scope filter (BI-4AA1074B Slice 2; spec §5.2). Pulled into a
  // single local so the three retrieval branches and the post-filter
  // share semantics. When the caller did not pass `ringScope`, or passed
  // `["universal-ring"]`, ring-scope filtering is a no-op everywhere
  // (the full kernel reaches the decision math).
  const ringScope = input.ringScope;
  const ringScopeActive =
    ringScope !== undefined &&
    ringScope.length > 0 &&
    !ringScope.includes("universal-ring");

  // ── Branch 1: commandments from Postgres ──
  // Pass ringScope through to listPrinciplesByTier so the Prisma AND/OR
  // clause does the heavy filtering server-side. Post-filter is still
  // applied below to enforce the contract symmetrically with the Qdrant
  // branches (and to catch any Prisma client that didn't propagate the
  // arg through, e.g. in tests with a narrow mock).
  let commandmentsRaw: RecalledCommandment[] = [];
  try {
    const rows = await listPrinciplesByTier(prisma, {
      tier: "commandment",
      organizationId: input.organizationId,
      appliesTo: input.callingPopulation,
      ringScope: ringScope,
      limit: COMMANDMENT_RETRIEVAL_CAP,
    });
    commandmentsRaw = rows as RecalledCommandment[];
  } catch (err) {
    console.warn("[recallPrincipleContext] commandment Postgres lookup failed:", err);
  }

  // ── Branch 2: relevant core principles from Qdrant ──
  let coreRaw: WikiSearchResult[] = [];
  try {
    coreRaw = await searchWikiPages({
      query: input.query,
      organizationId: input.organizationId,
      pageKind: "principle",
      principleTier: "core",
      principleAppliesTo: input.callingPopulation,
      principleRingScope: ringScopeActive ? ringScope : undefined,
      limit: coreLimit,
    });
  } catch (err) {
    console.warn("[recallPrincipleContext] core Qdrant lookup failed:", err);
  }

  // ── Branch 3: contextual principles above similarity threshold ──
  let contextualRaw: WikiSearchResult[] = [];
  try {
    contextualRaw = await searchWikiPages({
      query: input.query,
      organizationId: input.organizationId,
      pageKind: "principle",
      principleTier: "contextual",
      principleAppliesTo: input.callingPopulation,
      principleRingScope: ringScopeActive ? ringScope : undefined,
      limit: contextualLimit,
      scoreThreshold: contextualThreshold,
    });
  } catch (err) {
    console.warn("[recallPrincipleContext] contextual Qdrant lookup failed:", err);
  }

  // Post-filter (cheap belt-and-suspenders). Empty principleRingScope
  // passes (backward-compat); `universal-ring` always passes; otherwise
  // intersection check. Identical to the upstream Qdrant + Prisma rules.
  let commandmentsExcluded = 0;
  let coreExcluded = 0;
  let contextualExcluded = 0;
  let commandments: RecalledCommandment[] = commandmentsRaw;
  let core: WikiSearchResult[] = coreRaw;
  let contextual: WikiSearchResult[] = contextualRaw;
  if (ringScopeActive) {
    commandments = commandmentsRaw.filter((row) => {
      const ok = principleMatchesRingScope(
        row.principleRingScope ?? [],
        ringScope,
      );
      if (!ok) commandmentsExcluded++;
      return ok;
    });
    core = coreRaw.filter((row) => {
      const ok = principleMatchesRingScope(
        row.principleRingScope ?? [],
        ringScope,
      );
      if (!ok) coreExcluded++;
      return ok;
    });
    contextual = contextualRaw.filter((row) => {
      const ok = principleMatchesRingScope(
        row.principleRingScope ?? [],
        ringScope,
      );
      if (!ok) contextualExcluded++;
      return ok;
    });
  }

  // Telemetry. Mirrors the [tool-trace] and [kernel-gate-trace]
  // structured-log patterns. Spec §5.4. Always emit, even when nothing
  // surfaced — zero-recall events are themselves signal.
  console.info(
    `[principle-recall-trace] ` +
      JSON.stringify({
        callingSurface: input.callingSurface ?? null,
        callingPopulation: input.callingPopulation,
        ringScope: ringScope ?? null,
        ringScopeActive,
        commandmentCount: commandments.length,
        coreCount: core.length,
        contextualCount: contextual.length,
        ringScopeExcluded: {
          commandments: commandmentsExcluded,
          core: coreExcluded,
          contextual: contextualExcluded,
        },
      }),
  );

  const block = formatPrincipleContext({ commandments, core, contextual });
  if (block === null) return null;

  return {
    block,
    commandments,
    core,
    contextual,
    ringScopeExcluded: ringScopeActive
      ? {
          commandments: commandmentsExcluded,
          core: coreExcluded,
          contextual: contextualExcluded,
        }
      : undefined,
  };
}
