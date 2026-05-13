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

import { searchWikiPages, type WikiSearchResult } from "./embeddings";

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
  isKernel: boolean;
  organizationId: string | null;
};

export type RecallPrincipleContextResult = {
  /** Pre-formatted prompt block (or null when there's nothing to inject). */
  block: string;
  commandments: RecalledCommandment[];
  core: WikiSearchResult[];
  contextual: WikiSearchResult[];
};

// ─── Hard caps ──────────────────────────────────────────────────────────────

/**
 * Commandments are capped at 10 published kernel rows by the lint
 * detector `principle-commandment-cap-exceeded`. Recall mirrors that
 * cap so a misseeded corpus can't dump more commandments into the
 * prompt than the governance contract permits.
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

  // ── Branch 1: commandments from Postgres ──
  let commandments: RecalledCommandment[] = [];
  try {
    const rows = await listPrinciplesByTier(prisma, {
      tier: "commandment",
      organizationId: input.organizationId,
      appliesTo: input.callingPopulation,
      limit: COMMANDMENT_RETRIEVAL_CAP,
    });
    commandments = rows as RecalledCommandment[];
  } catch (err) {
    console.warn("[recallPrincipleContext] commandment Postgres lookup failed:", err);
  }

  // ── Branch 2: relevant core principles from Qdrant ──
  let core: WikiSearchResult[] = [];
  try {
    core = await searchWikiPages({
      query: input.query,
      organizationId: input.organizationId,
      pageKind: "principle",
      principleTier: "core",
      principleAppliesTo: input.callingPopulation,
      limit: coreLimit,
    });
  } catch (err) {
    console.warn("[recallPrincipleContext] core Qdrant lookup failed:", err);
  }

  // ── Branch 3: contextual principles above similarity threshold ──
  let contextual: WikiSearchResult[] = [];
  try {
    contextual = await searchWikiPages({
      query: input.query,
      organizationId: input.organizationId,
      pageKind: "principle",
      principleTier: "contextual",
      principleAppliesTo: input.callingPopulation,
      limit: contextualLimit,
      scoreThreshold: contextualThreshold,
    });
  } catch (err) {
    console.warn("[recallPrincipleContext] contextual Qdrant lookup failed:", err);
  }

  const block = formatPrincipleContext({ commandments, core, contextual });
  if (block === null) return null;

  return { block, commandments, core, contextual };
}
