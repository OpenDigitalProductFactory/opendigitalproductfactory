// EP-27FD96BC · P5 (BI-BC37727B) — memory → corpus automatic promotion.
//
// The coworker memory stores and the WWWD org corpus were two disconnected
// planes: enrichOrgCorpus was fed only by onboarding + AI research, never by the
// facts a coworker learns in conversation. Yet a UserFact already carries the
// exact signal that a fact belongs to the organization: scope="org" (a durable
// business fact, readable across every employee) + sensitivity="normal" (safe to
// share). Those facts ARE org corpus material — they were just never routed there.
//
// This is the memory-source adapter: a nightly promoter that maps durable
// org-scoped facts through the existing enrichOrgCorpus façade. Kernel decision
// (DI, principle_decide 2026-07-11): BATCH-NIGHTLY over real-time fire-and-forget
// (composite 8.94 vs 7.04, high confidence) — keeps LLM inference off the
// interactive write path and matches the proof-point "a fact learned in chat
// appears in the corpus next day."
//
// enrichOrgCorpus lands everything DRAFT-by-default (a human reviews before it
// becomes authoritative), so promotion never silently rewrites the org's stance.
// The corpusPromotedAt marker makes the pass idempotent: a promoted fact is never
// re-inferred, and a superseded fact's replacement row starts NULL, so a changed
// value re-promotes and refreshes the same corpus page (sourceRef is keyed on the
// stable fact key).

import { prisma } from "@dpf/db";
import {
  enrichOrgCorpus,
  type EnrichOrgCorpusInput,
  type EnrichmentProvenance,
} from "@/lib/wiki/enrich-org-corpus";
import { createProductionInference } from "@/lib/wiki/inference-adapter";

/** The fact fields the promoter reads. Structural so tests need no Prisma. */
export interface PromotableFact {
  id: string;
  category: string; // preference | decision | constraint | domain_context
  key: string;
  value: string;
  scope: string;
  sensitivity: string;
  supersededAt: Date | null;
  corpusPromotedAt: Date | null;
}

// Preference facts are per-user relationship memory ("likes terse replies"), not
// organizational knowledge — they never belong in the org corpus even when the
// scope classifier marks them org. The durable business categories (decision,
// constraint, domain_context) do.
export const NON_CORPUS_CATEGORIES: ReadonlySet<string> = new Set(["preference"]);

/**
 * A fact promotes iff it is a durable, shareable, not-yet-promoted org fact of a
 * business category. Pure.
 */
export function isPromotableFact(fact: PromotableFact): boolean {
  return (
    fact.scope === "org" &&
    fact.sensitivity === "normal" &&
    fact.supersededAt == null &&
    fact.corpusPromotedAt == null &&
    !NON_CORPUS_CATEGORIES.has(fact.category)
  );
}

/**
 * Map a durable fact onto the enrichOrgCorpus contract. sourceRef is keyed on the
 * stable fact key so a re-promotion (after supersession) upserts the SAME corpus
 * page rather than orphaning it. Pure — the caller supplies `infer`.
 */
export function buildFactCorpusInput(
  fact: PromotableFact,
  organizationId: string,
): Omit<EnrichOrgCorpusInput, "infer"> {
  const provenance: EnrichmentProvenance = {
    sourceType: "qa", // learned in an employee's conversation with a coworker
    sourceRef: { factKey: fact.key, category: fact.category },
  };
  return {
    organizationId,
    text: `${fact.key}: ${fact.value}`,
    provenance,
    // An employee stated it directly to the coworker → first-party evidence.
    trust: "first-party",
    title: `Business fact — ${fact.key}`,
  };
}

export interface PromoteOrgFactsDeps {
  db?: {
    organization: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
    userFact: {
      findMany: (args: unknown) => Promise<PromotableFact[]>;
      update: (args: unknown) => Promise<unknown>;
    };
  };
  /** Injectable for tests; production maps a fact through enrichOrgCorpus. */
  enrich?: (input: Omit<EnrichOrgCorpusInput, "infer">) => Promise<unknown>;
  /** Max facts promoted per pass (keeps the nightly window bounded). */
  limit?: number;
}

export interface PromoteOrgFactsResult {
  promoted: number;
  failed: number;
}

/**
 * Promote durable org-scoped facts into the WWWD org corpus. One install = one
 * organization, so this is an install-wide pass. Each fact is handled
 * independently; one failure is logged and does not abort the pass.
 */
export async function promoteOrgFactsToCorpus(
  deps: PromoteOrgFactsDeps = {},
): Promise<PromoteOrgFactsResult> {
  const db = deps.db ?? (prisma as unknown as NonNullable<PromoteOrgFactsDeps["db"]>);
  const limit = deps.limit ?? 50;
  const enrich =
    deps.enrich ??
    ((input: Omit<EnrichOrgCorpusInput, "infer">) =>
      enrichOrgCorpus({
        ...input,
        infer: createProductionInference({ taskType: "wiki_proposal" }),
      }));

  const org = await db.organization.findFirst({ select: { id: true } });
  if (!org) return { promoted: 0, failed: 0 };

  const candidates = await db.userFact.findMany({
    where: {
      scope: "org",
      sensitivity: "normal",
      supersededAt: null,
      corpusPromotedAt: null,
      category: { notIn: Array.from(NON_CORPUS_CATEGORIES) },
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    take: limit,
  });

  let promoted = 0;
  let failed = 0;
  for (const fact of candidates) {
    // Defensive: the query already filters, but keep the pure guard authoritative.
    if (!isPromotableFact(fact)) continue;
    try {
      await enrich(buildFactCorpusInput(fact, org.id));
      await db.userFact.update({
        where: { id: fact.id },
        data: { corpusPromotedAt: new Date() },
      });
      promoted += 1;
    } catch (err) {
      console.warn(`[memory-corpus] promote fact ${fact.id} failed:`, err);
      failed += 1;
    }
  }
  return { promoted, failed };
}
