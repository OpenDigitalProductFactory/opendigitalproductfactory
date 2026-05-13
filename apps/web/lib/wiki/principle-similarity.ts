// Phase 1 Task 1.8 of the principles-as-wiki-kind plan: similarity-based
// detectors. Pure functions that take pre-computed direction embeddings
// keyed by pageId. The orchestrator (lint.ts) calls generateEmbedding on
// each principle's direction string before invoking these detectors, so
// the detectors themselves stay deterministic and easy to test.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1 Task 1.8)

import type { LintFinding } from "./lint-detectors";
import type { LintPrincipleWikiPage } from "./principle-lint-detectors";

// ─── Tunables ───────────────────────────────────────────────────────────────

const DUPLICATE_COSINE_THRESHOLD = 0.9;
const DUPLICATE_MIN_SHARED_TITLE_TOKENS = 3;
const CONTRADICTION_COSINE_THRESHOLD = 0.75;
const CONTRADICTION_OPPOSITION_THRESHOLD = 0.1; // values within +/- this count as neutral

// ─── Helpers ────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Cheap title-token comparator: lowercase, strip non-alphanumeric, split,
 * drop short tokens and a small stoplist. No real stemming — just enough
 * to catch obvious near-duplicates without pulling in a stemmer dependency.
 */
const TITLE_STOPLIST = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "over",
  "the",
  "to",
  "with",
]);

function tokenizeTitle(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TITLE_STOPLIST.has(t));
  return new Set(tokens);
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) {
    if (b.has(t)) count++;
  }
  return count;
}

/**
 * Order pages newest-first by lastReviewedAt. Pages with no review
 * timestamp fall back to descending id so re-runs are deterministic.
 * Mirrors orderNewestFirst in principle-commandment-cap.ts.
 */
function isNewer(a: LintPrincipleWikiPage, b: LintPrincipleWikiPage): boolean {
  const aTime = a.lastReviewedAt?.getTime() ?? null;
  const bTime = b.lastReviewedAt?.getTime() ?? null;
  if (aTime !== null && bTime !== null) return aTime > bTime;
  if (aTime !== null) return true;
  if (bTime !== null) return false;
  return a.id > b.id;
}

function principlePages(
  pages: LintPrincipleWikiPage[],
): LintPrincipleWikiPage[] {
  return pages.filter((p) => p.pageKind === "principle");
}

// ─── 1. principle-duplicate ─────────────────────────────────────────────────

/**
 * Pairwise duplicate detection: when two principle pages' direction
 * embeddings have cosine similarity >= 0.9 AND their titles share at
 * least 3 non-stopword tokens, flag the newer page as a duplicate of
 * the older one.
 *
 * Severity: warn. Doesn't block publish — a true duplicate needs human
 * review (one merged into the other), not an automatic deletion.
 *
 * Per-page aggregation: even if a page is duplicate-of multiple older
 * pages, emit at most one finding per newer page (against the highest-
 * similarity older match) to keep the lint UI legible.
 */
export function detectPrincipleDuplicate(input: {
  pages: LintPrincipleWikiPage[];
  embeddings: Map<string, number[]>;
}): LintFinding[] {
  const pages = principlePages(input.pages);
  const titleTokens = new Map<string, Set<string>>();
  for (const p of pages) titleTokens.set(p.id, tokenizeTitle(p.title));

  // Best (highest-cosine) older match for each page
  const bestMatch = new Map<
    string,
    { older: LintPrincipleWikiPage; cosine: number }
  >();

  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i];
      const b = pages[j];
      const ea = input.embeddings.get(a.id);
      const eb = input.embeddings.get(b.id);
      if (!ea || !eb) continue;

      const cosine = cosineSimilarity(ea, eb);
      if (cosine < DUPLICATE_COSINE_THRESHOLD) continue;

      const shared = sharedTokenCount(
        titleTokens.get(a.id) ?? new Set(),
        titleTokens.get(b.id) ?? new Set(),
      );
      if (shared < DUPLICATE_MIN_SHARED_TITLE_TOKENS) continue;

      const [older, newer] = isNewer(a, b) ? [b, a] : [a, b];
      const prior = bestMatch.get(newer.id);
      if (!prior || cosine > prior.cosine) {
        bestMatch.set(newer.id, { older, cosine });
      }
    }
  }

  const findings: LintFinding[] = [];
  for (const [pageId, match] of bestMatch) {
    const page = pages.find((p) => p.id === pageId);
    if (!page) continue;
    findings.push({
      organizationId: page.organizationId,
      pageId: page.id,
      findingKind: "principle-duplicate",
      severity: "warn",
      detail: {
        slug: page.slug,
        blocksPublish: false,
        duplicateOf: match.older.id,
        duplicateOfSlug: match.older.slug,
        cosine: Number(match.cosine.toFixed(3)),
        message:
          "This principle has a near-duplicate older sibling. Consider merging " +
          "into the older page or rewriting one to clarify how they differ.",
      },
    });
  }
  return findings;
}

// ─── Aggregator ─────────────────────────────────────────────────────────────

/**
 * Run both similarity-based detectors against a snapshot + pre-computed
 * embeddings. The orchestrator calls this in addition to runPrincipleDetectors
 * (which handles the per-page and cross-page detectors that don't need
 * embeddings).
 */
export function runPrincipleSimilarityDetectors(input: {
  pages: LintPrincipleWikiPage[];
  embeddings: Map<string, number[]>;
}): LintFinding[] {
  return [
    ...detectPrincipleDuplicate(input),
    ...detectPrincipleContradictionReview(input),
  ];
}

// ─── 2. principle-contradiction-review ──────────────────────────────────────

/**
 * Pairwise contradiction detection: when two principle pages share at
 * least one dimension key with opposing signs (one above
 * +CONTRADICTION_OPPOSITION_THRESHOLD, the other below
 * -CONTRADICTION_OPPOSITION_THRESHOLD) AND their direction embeddings
 * have cosine similarity > 0.75 (i.e., they speak to the same topic),
 * flag BOTH pages for human review.
 *
 * The 0.75 cosine gate is what distinguishes "contradiction" from
 * "different principles legitimately pulling in different directions" —
 * unrelated principles with opposite signs on a dimension are fine; only
 * principles that read similar but pull opposite ways need a reviewer
 * note explaining the intentional tension.
 *
 * Severity: warn. Doesn't block publish — contradictions can be
 * intentional; the lint just forces an explicit review note.
 */
export function detectPrincipleContradictionReview(input: {
  pages: LintPrincipleWikiPage[];
  embeddings: Map<string, number[]>;
}): LintFinding[] {
  const pages = principlePages(input.pages);
  const flagged = new Map<
    string,
    { partnerId: string; opposingDimensions: string[]; cosine: number }
  >();

  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i];
      const b = pages[j];
      const ea = input.embeddings.get(a.id);
      const eb = input.embeddings.get(b.id);
      if (!ea || !eb) continue;

      const cosine = cosineSimilarity(ea, eb);
      if (cosine <= CONTRADICTION_COSINE_THRESHOLD) continue;

      const va = a.principleDimensionVector ?? {};
      const vb = b.principleDimensionVector ?? {};
      const opposing: string[] = [];
      for (const dim of Object.keys(va)) {
        if (!(dim in vb)) continue;
        const sa = va[dim];
        const sb = vb[dim];
        if (
          (sa > CONTRADICTION_OPPOSITION_THRESHOLD &&
            sb < -CONTRADICTION_OPPOSITION_THRESHOLD) ||
          (sa < -CONTRADICTION_OPPOSITION_THRESHOLD &&
            sb > CONTRADICTION_OPPOSITION_THRESHOLD)
        ) {
          opposing.push(dim);
        }
      }
      if (opposing.length === 0) continue;

      // Flag both pages — record only the highest-cosine partner per page
      // so the finding stays single per page.
      for (const [self, other] of [
        [a, b],
        [b, a],
      ] as const) {
        const prior = flagged.get(self.id);
        if (!prior || cosine > prior.cosine) {
          flagged.set(self.id, {
            partnerId: other.id,
            opposingDimensions: opposing,
            cosine,
          });
        }
      }
    }
  }

  const findings: LintFinding[] = [];
  for (const [pageId, info] of flagged) {
    const page = pages.find((p) => p.id === pageId);
    const partner = pages.find((p) => p.id === info.partnerId);
    if (!page) continue;
    findings.push({
      organizationId: page.organizationId,
      pageId: page.id,
      findingKind: "principle-contradiction-review",
      severity: "warn",
      detail: {
        slug: page.slug,
        blocksPublish: false,
        partnerId: info.partnerId,
        partnerSlug: partner?.slug ?? null,
        opposingDimensions: info.opposingDimensions,
        cosine: Number(info.cosine.toFixed(3)),
        message:
          "This principle pulls in an opposing direction to a similar " +
          "principle on at least one shared dimension. Confirm the tension " +
          "is intentional and add a reviewer note explaining when each " +
          "principle wins.",
      },
    });
  }
  return findings;
}
