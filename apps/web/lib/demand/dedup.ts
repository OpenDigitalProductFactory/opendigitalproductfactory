// Pure deduplication helpers — no server imports. Safe in tests and client
// components. EP-DEMAND-MGMT Phase 5.
//
// Finds near-duplicate demand and computes a merge that concentrates signal
// (reach) on the survivor instead of fragmenting it across duplicates. Uses a
// deterministic character-trigram Dice similarity so it needs no embedding
// round-trip; a semantic-embedding upgrade and the auto-at-ingest hook are
// follow-ups. Spec: docs/superpowers/specs/2026-07-10-demand-management-design.md §6.

/** Normalize to lowercase alphanumeric words. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Character trigrams of the normalized text. */
export function trigrams(text: string): Set<string> {
  const norm = normalize(text);
  const grams = new Set<string>();
  if (norm.length < 3) {
    if (norm.length > 0) grams.add(norm);
    return grams;
  }
  for (let i = 0; i <= norm.length - 3; i++) grams.add(norm.slice(i, i + 3));
  return grams;
}

/** Sørensen–Dice coefficient over character trigrams (0..1). */
export function diceSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return normalize(a) === normalize(b) ? 1 : 0;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const g of ta) if (tb.has(g)) intersection++;
  return (2 * intersection) / (ta.size + tb.size);
}

export type DedupItem = {
  itemId: string;
  title: string;
  body?: string | null;
};

/**
 * Similarity between two items — title-dominant (0.8) with a light body signal
 * (0.2), so items with the same intent phrased differently still match.
 */
export function itemSimilarity(a: DedupItem, b: DedupItem): number {
  const titleSim = diceSimilarity(a.title, b.title);
  const bodySim = a.body && b.body ? diceSimilarity(a.body, b.body) : 0;
  return Math.round((titleSim * 0.8 + bodySim * 0.2) * 1000) / 1000;
}

export type DuplicateCandidate = {
  itemId: string;
  title: string;
  similarity: number;
};

/**
 * Rank open items by similarity to `target`, returning those at or above
 * `threshold` (default 0.5), most-similar first. Excludes the target itself.
 */
export function findDuplicateCandidates(
  target: DedupItem,
  items: DedupItem[],
  threshold = 0.5,
): DuplicateCandidate[] {
  return items
    .filter((i) => i.itemId !== target.itemId)
    .map((i) => ({ itemId: i.itemId, title: i.title, similarity: itemSimilarity(target, i) }))
    .filter((c) => c.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}

export type DuplicatePair = {
  a: string;
  b: string;
  titleA: string;
  titleB: string;
  similarity: number;
};

/**
 * All-pairs sweep: every pair of items at or above `threshold`, most-similar
 * first. Read-only detection over the open backlog — no hot-path cost at ingest.
 * O(n^2) in the candidate set; callers bound `items` (e.g. open, same portfolio).
 */
export function findDuplicatePairs(items: DedupItem[], threshold = 0.6): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const similarity = itemSimilarity(items[i], items[j]);
      if (similarity >= threshold) {
        pairs.push({
          a: items[i].itemId,
          b: items[j].itemId,
          titleA: items[i].title,
          titleB: items[j].title,
          similarity,
        });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}

export type MergeInput = {
  survivorOccurrenceCount: number;
  duplicateOccurrenceCount: number;
};

export type MergeResult = {
  /** New occurrenceCount on the survivor — reach is summed, not lost. */
  mergedOccurrenceCount: number;
};

/**
 * Compute the survivor's post-merge state: reach (occurrenceCount) is the sum
 * of both items, so merging concentrates the demand signal.
 */
export function computeMerge(input: MergeInput): MergeResult {
  const survivor = Number.isFinite(input.survivorOccurrenceCount) ? input.survivorOccurrenceCount : 1;
  const duplicate = Number.isFinite(input.duplicateOccurrenceCount) ? input.duplicateOccurrenceCount : 1;
  return { mergedOccurrenceCount: Math.max(1, survivor) + Math.max(0, duplicate) };
}
