// apps/web/lib/operate/implementation-scan.ts
//
// BI-1A1EC5EC — check a proposed backlog item against the implementations that
// already exist, at filing time.
//
// THE GAP: the platform detects that a new BI duplicates another BI (demand/dedup.ts,
// trigram Dice over backlog text) and has dozens of gates comparing code to code.
// NOTHING compared a proposed BI to the code already on disk. "We should build X"
// could be filed, sized and epic-linked with no check that X was sitting in scripts/.
//
// LIVE CASE, 2026-08-05. BI-3E5969DF was filed to "detect semantic doc staleness".
// scripts/build-docs-staleness.mjs — a working detector with a weekly refresh
// workflow — had existed for weeks. The filing session ran query_backlog per epic,
// search_portfolio_context on the topic, and an epic sweep. All came back clean,
// because ALL OF THEM SEARCH BACKLOG ROWS AND PRODUCTS, NOT SOURCE.
//
// WHY FILENAMES, NOT SEMANTICS. The heuristic that would have caught it in one
// command is `ls scripts/*stale*`. Implementations are named LITERALLY
// ("build-docs-staleness.mjs"); backlog items are named CONCEPTUALLY ("detect
// semantic doc staleness"). Embedding and trigram search both work on the concept
// side and are weakest at exactly this crossing. Matching salient title words
// against path segments is cruder, far cheaper, and hits the case that actually
// recurs.
//
// This also makes the scan INDEPENDENT OF THE CODE-GRAPH INDEX. BI-1A3CC151 is open:
// the code graph is indexed off a behind-main branch and is missing files. A check
// built on a stale index yields FALSE NEGATIVES — worse than no check, because it
// manufactures confidence in the very place confidence failed. A walk of the working
// tree cannot be stale.
//
// ADVISORY, NEVER A GATE. A doc-staleness item legitimately matches every path
// containing "stale". Blocking on that reproduces the noise failure the BI-3E5969DF
// spike recommended against one level up. This module RANKS and RETURNS; the caller
// surfaces. Mandatory dismissal is deliberately deferred until the hit rates from
// scripts/measure-implementation-scan.mjs justify it.

/** A file that may already implement what the item proposes to build. */
export interface ImplementationCandidate {
  /** Repo-relative POSIX path. */
  path: string;
  /** Salient item terms matched in the path, in title order. */
  matchedTerms: string[];
  /** Higher = more likely the same thing. Not a probability. */
  score: number;
}

export interface ScanOptions {
  /** Max candidates returned (default 5). Ranked, so the tail is the weak end. */
  limit?: number;
  /** Minimum score to report (default 2). Below this, precision collapses. */
  minScore?: number;
}

/**
 * Verbs that mean "this item proposes to CREATE something".
 *
 * Scanning only these is the precision lever: a bug report ("timesheet approval
 * lets any user approve anyone's") should not be told that timesheet code exists.
 * Of course it exists — that is the point of the bug.
 */
const BUILD_INTENT_VERBS = [
  "add", "build", "create", "detect", "implement", "introduce",
  "generate", "expose", "surface", "wire", "project", "support",
];

/**
 * Words carrying no discriminating power in a DPF item title. Matching on these
 * returns half the repo. "gate", "check" and "guard" are deliberately ABSENT —
 * in this codebase they are strong signals, not noise (check-*.mjs, *-guard.ts).
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "cannot", "do",
  "does", "for", "from", "has", "have", "in", "into", "is", "it", "its", "not",
  "of", "on", "onto", "or", "our", "so", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "to", "up", "via", "was", "we",
  "were", "what", "when", "where", "which", "while", "who", "why", "will",
  "with", "without", "you", "your",
  // Build verbs are intent markers, not subject matter — matching them would
  // rank every file whose name happens to contain "add" or "create".
  ...BUILD_INTENT_VERBS,
  // Ubiquitous in this repo; present in a large share of paths.
  "dpf", "platform", "system", "new", "item", "work", "use", "using", "should",
]);

/**
 * Path segments that are structure, not subject matter.
 *
 * STORED AS STEMS, because that is what they are compared against — a literal
 * "scripts" here would never match, since stem("scripts") is "script", and every
 * file under scripts/ would then score for a term like "script".
 */
const PATH_NOISE = new Set([
  "app", "web", "lib", "src", "package", "script", "component",
  "index", "type", "util", "helper", "test", "spec", "db",
]);

/** Lowercase alphanumeric words, splitting camelCase and kebab/snake boundaries. */
function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Crude singular form, so "staleness"/"stale" and "edges"/"edge" co-match.
 *
 * The two narrow rules exist because the naive ones corrupt real DPF vocabulary:
 * a blanket `-es` strip turns "edges" into "edg" and "pages" into "pag", and a
 * blanket `-s` strip turns "corpus" into "corpu" and "status" into "statu". So
 * `-es` is only removed after a sibilant (matches → match, boxes → box), and `-s`
 * is left alone on -ss/-us/-is endings.
 */
function stem(word: string): string {
  // The remainder must still look like a word: "staleness" → "stale" is right,
  // but "harness" → "har" is not a stem, it is a fragment that then matches
  // "hardware" and "harbor". Measured on real titles: this produced the only
  // spurious high-score hit in the first replay.
  if (word.length > 5 && word.endsWith("ness") && word.length - 4 >= 4) {
    return word.slice(0, -4);
  }
  if (word.length > 4 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * True when the item proposes to CREATE something, so an existing implementation
 * would be a duplicate rather than the subject.
 *
 * `workType` alone is not enough: "feature" covers both "add X" and "X is missing
 * a field". The verb in the title is the honest signal.
 */
export function detectsBuildIntent(title: string, workType?: string | null): boolean {
  // A bug is about something that already exists, by definition.
  if (workType === "bug") return false;
  const w = words(title);
  return w.some((word) => BUILD_INTENT_VERBS.includes(word));
}

/**
 * The words from a title worth matching against file paths.
 *
 * Deduplicated, stemmed, order-preserving. Single characters and pure digits are
 * dropped — they match everywhere.
 */
export function salientTerms(title: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of words(title)) {
    if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    const s = stem(word);
    if (s.length < 3 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Score one path against the item's terms.
 *
 * Weighting reflects where a name actually lives: the FILENAME is what an author
 * chooses to describe the thing, while directories describe where it sits. A term
 * in the basename counts double, and matching several distinct terms is worth more
 * than matching one term loudly — "docs" alone should never outrank
 * "docs" + "stale".
 */
export function scorePath(terms: string[], filePath: string): { score: number; matchedTerms: string[] } {
  const posix = filePath.replace(/\\/g, "/");
  const base = posix.slice(posix.lastIndexOf("/") + 1);
  const baseWords = new Set(words(base).map(stem).filter((w) => !PATH_NOISE.has(w)));
  const dirWords = new Set(
    words(posix.slice(0, posix.lastIndexOf("/") + 1)).map(stem).filter((w) => !PATH_NOISE.has(w)),
  );

  const matchedTerms: string[] = [];
  let score = 0;
  for (const term of terms) {
    if (baseWords.has(term)) {
      score += 2;
      matchedTerms.push(term);
    } else if (dirWords.has(term)) {
      score += 1;
      matchedTerms.push(term);
    }
  }
  // Reward breadth: two distinct terms in one filename is a much stronger signal
  // than one, and this is what separates a real hit from an incidental one.
  if (matchedTerms.length > 1) score += matchedTerms.length - 1;
  return { score, matchedTerms };
}

/**
 * Rank files that may already implement what `title` proposes.
 *
 * PURE — takes the file list, returns candidates. No filesystem, no database, no
 * clock. The caller supplies the inventory, which is what lets this be tested
 * exhaustively and keeps the scan independent of any index.
 *
 * Returns [] when the item is not build-intent, which is the main precision guard.
 */
export function findImplementationCandidates(
  title: string,
  filePaths: string[],
  options: ScanOptions & { workType?: string | null } = {},
): ImplementationCandidate[] {
  const { limit = 5, minScore = 2, workType } = options;
  if (!detectsBuildIntent(title, workType)) return [];

  const terms = salientTerms(title);
  // One term cannot distinguish "the same thing" from "the same topic".
  if (terms.length < 2) return [];

  const scored: ImplementationCandidate[] = [];
  for (const filePath of filePaths) {
    const { score, matchedTerms } = scorePath(terms, filePath);
    // TWO distinct terms, always. Measured on real titles, single-term hits were
    // the entire false-positive population: "Create a payroll remittance
    // reconciliation ledger" matched five unrelated files on `ledger` alone, and
    // a scan that answers "something here says ledger" is not answering "this is
    // already built". One term finds the topic; two start to find the thing.
    if (score >= minScore && matchedTerms.length >= 2) {
      scored.push({ path: filePath.replace(/\\/g, "/"), matchedTerms, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, limit);
}

/** Append the advisory to a caller's message, or return it unchanged. */
export function withScanAdvisory(
  message: string,
  candidates: ImplementationCandidate[],
): string {
  const advisory = renderScanAdvisory(candidates);
  return advisory ? `${message}\n\n${advisory}` : message;
}

/**
 * One-line advisory for the filer. Deliberately phrased as a question, not a
 * verdict — the scan is a prompt to look, and it is wrong often enough that
 * asserting a duplicate would train people to ignore it.
 */
export function renderScanAdvisory(candidates: ImplementationCandidate[]): string | null {
  if (candidates.length === 0) return null;
  const lines = candidates.map((c) => `  - ${c.path} (matched: ${c.matchedTerms.join(", ")})`);
  return [
    "Possible existing implementation(s) — confirm this is not already built before starting:",
    ...lines,
    "A backlog sweep does not answer this: query_backlog and search_portfolio_context search backlog rows and products, not source.",
  ].join("\n");
}
