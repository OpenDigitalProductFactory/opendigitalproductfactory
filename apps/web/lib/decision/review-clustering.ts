// Semantic clustering for the operator's decision-review queue (BI-932C2A81).
//
// `review-identity.ts` collapses only byte-identical questions. That was a
// deliberate conservative choice — one answer closes every row in a cluster, so
// only provably-identical questions were joined — but it left the operator
// answering the same decision repeatedly under different phrasings. Live: 13
// unresolved rows presented as 6 cards that were really 3 decisions, and
// answering one variant left its siblings open, so the queue read as though it
// were not draining.
//
// This raises the bar rather than abandoning it:
//
//   * Similarity must clear a HIGH floor (SEMANTIC_CLUSTER_THRESHOLD). Near
//     misses stay separate.
//   * Clustering ignores `domainClass`. BI-F5F2869D made domain a prior rather
//     than a gate precisely because the same question gets bucketed differently
//     by different callers; re-imposing that split here would undo it.
//   * It never crosses `profileId` — a different perspective is a different
//     owner's doctrine, not a paraphrase.
//   * When the embedding layer is unavailable it degrades to the proven
//     exact-lexical identity rather than guessing, matching the BI-7E1F128A
//     fail-safe posture. An outage must never widen what one answer resolves.
//
// Every DecisionInteraction row is retained as audit history; this collapses
// presentation and resolution only.

import { cosineSimilarity } from "@/lib/decision-perspective/stance-relevance";
import { decisionReviewIdentity, type DecisionReviewIdentityInput } from "./review-identity";

/**
 * Cosine floor for treating two questions as the same decision. Deliberately
 * high: the cost of a false merge is resolving a decision the operator never
 * read, which is strictly worse than showing one extra card.
 */
export const SEMANTIC_CLUSTER_THRESHOLD = 0.92;

export type ReviewCluster<T> = {
  /** Newest row in the cluster — the one whose wording the operator sees. */
  representative: T;
  /** Every row this cluster speaks for, representative included. */
  members: T[];
  /** Convenience alias for `members.length`, matching the existing card field. */
  occurrenceCount: number;
};

export type ReviewClusteringResult<T> = {
  clusters: ReviewCluster<T>[];
  method: "semantic" | "lexical";
};

type ClusterableRow = DecisionReviewIdentityInput & { question: string };

/**
 * Group unresolved review rows into one cluster per underlying decision.
 * Rows must arrive newest-first; the first row of a cluster stays its
 * representative, preserving the existing "newest wording wins" behaviour.
 */
export async function clusterDecisionReviewRowsSemantic<T extends ClusterableRow>(
  rows: T[],
  options: {
    embed?: (text: string) => Promise<number[] | null>;
    threshold?: number;
  } = {},
): Promise<ReviewClusteringResult<T>> {
  if (rows.length === 0) return { clusters: [], method: "lexical" };

  const threshold = options.threshold ?? SEMANTIC_CLUSTER_THRESHOLD;
  const embed =
    options.embed ??
    (async (text: string) => {
      const { generateEmbedding } = await import("@/lib/inference/embedding");
      return generateEmbedding(text);
    });

  const embeddings = await Promise.all(
    rows.map((r) => embed(r.question).catch(() => null)),
  );

  // Partial coverage is not a partial signal: a row we could not embed would be
  // compared against nothing and silently become its own cluster, which reads
  // as "the queue grew" rather than "retrieval degraded". All-or-nothing.
  const usable =
    embeddings.length === rows.length
    && embeddings.every((e) => e !== null && e.length > 0 && e.length === embeddings[0]!.length);

  if (!usable) return { clusters: lexicalClusters(rows), method: "lexical" };

  const clusters: Array<ReviewCluster<T> & { vector: number[] }> = [];
  rows.forEach((row, index) => {
    const vector = embeddings[index] as number[];
    const match = clusters.find(
      (cluster) =>
        cluster.representative.profileId === row.profileId
        && cosineSimilarity(cluster.vector, vector) >= threshold,
    );
    if (match) {
      match.members.push(row);
      match.occurrenceCount = match.members.length;
      return;
    }
    clusters.push({ representative: row, members: [row], occurrenceCount: 1, vector });
  });

  return {
    clusters: clusters.map(({ vector: _vector, ...cluster }) => cluster),
    method: "semantic",
  };
}

/** Exact-lexical fallback — the pre-existing, provable identity. */
function lexicalClusters<T extends ClusterableRow>(rows: T[]): ReviewCluster<T>[] {
  const byKey = new Map<string, ReviewCluster<T>>();
  for (const row of rows) {
    const key = decisionReviewIdentity(row);
    const existing = byKey.get(key);
    if (existing) {
      existing.members.push(row);
      existing.occurrenceCount = existing.members.length;
    } else {
      byKey.set(key, { representative: row, members: [row], occurrenceCount: 1 });
    }
  }
  return [...byKey.values()];
}
