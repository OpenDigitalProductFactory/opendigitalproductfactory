// Question ↔ stance relevance for the WWWD/WWMD decision gate (BI-7E1F128A).
//
// The evaluator used to score confidence purely from domain-coverage — the
// AVERAGE effective weight of every material whose `domainClass` matched, with
// the QUESTION TEXT never read. So two opposite decisions in the same domain
// (a blatantly off-mission one and a core on-mission one) resolved to the SAME
// applicable materials and produced an identical confidence + escalate verdict.
// The recorded stance was selected but could not discriminate.
//
// This module supplies the missing signal: how RELEVANT each applicable stance
// material is to THIS question. Relevance is semantic (cosine over embeddings of
// the question vs each material's summary) with a lexical token-overlap fallback
// when the embedding model is unavailable — the gate is fail-closed, so it must
// still produce a content signal on a cold install. Scores are min-max
// normalised WITHIN the applicable set so the most-on-point stance dominates
// regardless of the embedding model's absolute-similarity baseline; the least
// on-point stance falls away. The evaluator then weights each material by
// relevance and reads its `direction` to produce a directional, content-aware
// verdict.

import type { PerspectiveMaterial } from "./types";

/** Cosine similarity of two equal-length numeric vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "be", "we", "our", "should", "do", "does", "did", "can", "could",
  "would", "will", "shall", "how", "what", "which", "that", "this", "these",
  "those", "from", "by", "at", "as", "it", "its", "into", "than", "then",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

/** Jaccard-style overlap of the question against a material's summary + domains. */
function lexicalRelevance(questionTokens: Set<string>, material: PerspectiveMaterial): number {
  const materialTokens = tokenize(`${material.summary} ${material.domains.join(" ")}`);
  if (materialTokens.size === 0 || questionTokens.size === 0) return 0;
  let shared = 0;
  for (const token of materialTokens) {
    if (questionTokens.has(token)) shared += 1;
  }
  // Overlap relative to the material's own token count — a short, on-topic stance
  // should not be penalised for being short.
  return shared / materialTokens.size;
}

/** Min-max normalise a list of raw scores into [0,1]. A degenerate set (one
 *  entry, or all-equal) maps every entry to 1 — with a single applicable stance
 *  there is nothing to discriminate against, so it carries full relevance. */
function normalise(raw: number[]): number[] {
  if (raw.length <= 1) return raw.map(() => 1);
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  if (max - min < 1e-9) return raw.map(() => 1);
  return raw.map((value) => (value - min) / (max - min));
}

export type StanceRelevanceResult = {
  /** relevance ∈ [0,1] keyed by materialId (higher = more on-point for the question). */
  relevanceByMaterialId: Map<string, number>;
  /** How the signal was produced, for the audit trail. */
  method: "semantic" | "lexical";
};

/**
 * Compute how relevant each applicable stance material is to the question.
 *
 * Prefers semantic similarity (embeddings); falls back to lexical token overlap
 * when the embedding model is unavailable so the gate never loses its content
 * signal. Scores are min-max normalised within the applicable set. `embed` is
 * injectable for tests; it defaults to the platform embedding provider and may
 * return null when embeddings are unavailable (then we fall back to lexical).
 */
export async function computeStanceRelevance(input: {
  question: string;
  materials: PerspectiveMaterial[];
  embed?: (text: string) => Promise<number[] | null>;
}): Promise<StanceRelevanceResult> {
  const { question, materials } = input;
  const relevanceByMaterialId = new Map<string, number>();
  if (materials.length === 0) {
    return { relevanceByMaterialId, method: "lexical" };
  }

  const embed =
    input.embed ??
    (async (text: string) => {
      const { generateEmbedding } = await import("@/lib/inference/embedding");
      return generateEmbedding(text);
    });

  // Try semantic first: embed the question and every material summary.
  let method: "semantic" | "lexical" = "lexical";
  const questionEmbedding = await embed(question).catch(() => null);
  let rawScores: number[] | null = null;

  if (questionEmbedding && questionEmbedding.length > 0) {
    const materialEmbeddings = await Promise.all(
      materials.map((m) => embed(m.summary || m.domains.join(" ")).catch(() => null)),
    );
    if (materialEmbeddings.every((e) => e && e.length === questionEmbedding.length)) {
      method = "semantic";
      rawScores = materialEmbeddings.map((e) =>
        // cosine in [-1,1] → clamp negatives to 0; opposite-meaning text is "not relevant", not "negatively relevant".
        Math.max(0, cosineSimilarity(questionEmbedding, e as number[])),
      );
    }
  }

  if (!rawScores) {
    const questionTokens = tokenize(question);
    rawScores = materials.map((m) => lexicalRelevance(questionTokens, m));
  }

  const normalised = normalise(rawScores);
  materials.forEach((m, i) => relevanceByMaterialId.set(m.materialId, normalised[i]!));
  return { relevanceByMaterialId, method };
}
