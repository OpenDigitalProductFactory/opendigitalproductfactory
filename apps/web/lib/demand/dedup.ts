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

type PreparedDedupItem = DedupItem & {
  titleGrams: Set<string>;
  bodyGrams: Set<string> | null;
};

function prepareItem(item: DedupItem): PreparedDedupItem {
  return {
    ...item,
    titleGrams: trigrams(item.title),
    bodyGrams: item.body ? trigrams(item.body) : null,
  };
}

function diceFromSets(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const gram of small) if (large.has(gram)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

function preparedSimilarity(a: PreparedDedupItem, b: PreparedDedupItem): number {
  const titleSim = diceFromSets(a.titleGrams, b.titleGrams);
  const bodySim = a.bodyGrams && b.bodyGrams ? diceFromSets(a.bodyGrams, b.bodyGrams) : 0;
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
  const preparedTarget = prepareItem(target);
  return items
    .filter((i) => i.itemId !== target.itemId)
    .map((i) => {
      const prepared = prepareItem(i);
      return { itemId: i.itemId, title: i.title, similarity: preparedSimilarity(preparedTarget, prepared) };
    })
    .filter((c) => c.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity || a.itemId.localeCompare(b.itemId));
}

/**
 * Threshold for the advisory shown at filing time.
 *
 * Higher than `findDuplicateCandidates`' 0.5 default on purpose. That default
 * serves a deliberate sweep, where a human is already looking and a loose net
 * costs one glance. This runs on EVERY filing, so a false prompt is paid by
 * someone who did not ask for it, and an advisory people learn to skip is worse
 * than none. 0.6 matches `findDuplicatePairs`, which has the same all-comers
 * exposure.
 */
export const FILING_DUPLICATE_THRESHOLD = 0.6;

/** Candidates shown at filing time, most similar first. */
export const FILING_DUPLICATE_LIMIT = 3;

export type FilingDuplicateCandidate = DuplicateCandidate & {
  /** So the filer can tell "already being fixed" from "was fixed and regressed". */
  status: string;
  /**
   * Which signal found it. `lexical` shares vocabulary; `semantic` shares
   * meaning. They catch different misses and neither subsumes the other,
   * so the filer is told which one spoke.
   */
  matchedBy: "lexical" | "semantic" | "both";
};

/**
 * One advisory for the filer, phrased as a question rather than a verdict.
 *
 * The scan advisory next to this one (implementation-scan.ts) settled the
 * wording contract: asserting a duplicate trains people to ignore the line,
 * because the similarity score cannot know whether two items are the same
 * defect or adjacent ones. That judgment stays with the filer; this only
 * guarantees they see the other item before spending the investigation.
 */
export function renderFilingDuplicateAdvisory(
  candidates: readonly FilingDuplicateCandidate[],
  semanticUnavailableReason?: string | null,
): string | null {
  const lines = candidates.map(
    (c) => `  - ${c.itemId} [${c.status}] ${c.title} (${c.matchedBy})`,
  );
  // A search that could not run is not a clean result. Saying so costs one
  // line and stops a filer reading silence as "nothing similar exists" —
  // the rule AGENTS.md §4 states for gates, applied to an advisory.
  const degraded = semanticUnavailableReason
    ? `Meaning-based matching did not run (${semanticUnavailableReason}), so only shared wording was compared.`
    : null;
  if (lines.length === 0) return degraded;
  return [
    "Similar item(s) already filed — read them before starting, and absorb rather than re-diagnose:",
    ...lines,
    ...(degraded ? [degraded] : []),
    "If this is genuinely a different defect, say so in the body and carry on.",
  ].join("\n");
}

export type DuplicatePair = {
  a: string;
  b: string;
  titleA: string;
  titleB: string;
  similarity: number;
};

/**
 * Complete sweep: every pair that can reach `threshold`, most-similar first.
 * Read-only detection over the open backlog — no hot-path cost at ingest. For
 * ordinary thresholds, a title-gram index eliminates pairs that cannot reach
 * the score even with a perfect body match. `maxPairs` bounds retained output,
 * not population coverage.
 */
export function findDuplicatePairs(
  items: DedupItem[],
  threshold = 0.6,
  maxPairs = Number.POSITIVE_INFINITY,
): DuplicatePair[] {
  const prepared = [...items]
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
    .map(prepareItem);
  const postings = new Map<string, number[]>();
  const titleKeys = prepared.map((item) => item.titleGrams.size > 0
    ? item.titleGrams
    : new Set(["__EMPTY_TITLE__"]));

  // Body similarity contributes at most 0.2. Above that threshold a matching
  // pair must share at least one normalized title gram, so an inverted index
  // removes provably-impossible comparisons without weakening coverage.
  if (threshold > 0.2) {
    for (let index = 0; index < prepared.length; index += 1) {
      for (const gram of titleKeys[index]!) {
        const bucket = postings.get(gram) ?? [];
        bucket.push(index);
        postings.set(gram, bucket);
      }
    }
  }

  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    const candidates = new Set<number>();
    if (threshold > 0.2) {
      for (const gram of titleKeys[i]!) {
        for (const candidate of postings.get(gram) ?? []) {
          if (candidate > i) candidates.add(candidate);
        }
      }
    } else {
      for (let j = i + 1; j < prepared.length; j += 1) candidates.add(j);
    }
    for (const j of candidates) {
      const left = prepared[i]!;
      const right = prepared[j]!;
      const similarity = preparedSimilarity(left, right);
      if (similarity >= threshold) {
        pairs.push({
          a: left.itemId,
          b: right.itemId,
          titleA: left.title,
          titleB: right.title,
          similarity,
        });
      }
    }
    if (Number.isFinite(maxPairs) && pairs.length > maxPairs * 2) {
      pairs.sort(compareDuplicatePairs).splice(maxPairs);
    }
  }
  return pairs.sort(compareDuplicatePairs).slice(0, maxPairs);
}

function compareDuplicatePairs(x: DuplicatePair, y: DuplicatePair): number {
  return y.similarity - x.similarity || x.a.localeCompare(y.a) || x.b.localeCompare(y.b);
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
