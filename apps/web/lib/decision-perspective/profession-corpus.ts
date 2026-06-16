// apps/web/lib/decision-perspective/profession-corpus.ts
//
// WSID Phase 3 — runtime profession-corpus retrieval service.
//
// Closes the coverage→usage gap: PR #2016 made every coworker resolve to a
// profession family with seeded corpus, but nothing INJECTED that corpus into a
// coworker's prompt at runtime. This service is the single retrieval entry
// point that turns an Agent identity into prompt-ready professional grounding:
//
//   Agent identity → profession family → wsid-<key> profileId
//                  → corpus WikiPages (slug prefix `professions/<key>/`)
//                  → lexically-ranked, token-bounded excerpts → prompt block
//
// Why slug-prefix (not Qdrant): the profession corpus is seeded into Postgres
// WikiPage rows but is NOT embedded into the Qdrant wiki collection (Phase 2
// seeded pages only). A deterministic lexical ranker over the small per-family
// page set (4–9 pages) needs no vector sidecar, works on a cold install, and is
// fully unit-testable. When Phase 3+ seeds embeddings, this can swap to vector
// recall behind the same return shape.
//
// Contract: pure + db-injected (mirrors resolveProfessionProfile /
// resolveProfileMaterial) so callers in tests pass a structural fake. The
// caller decides what to do with `status` (record usage vs. gap) — this module
// computes, it does not write.

import {
  findProfessionFamilyForAgentIdentity,
  professionProfileId,
  type ProfessionAgentIdentity,
  type ProfessionFamily,
} from "./resolve-profession-profile";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ProfessionCorpusStatus =
  | "injected" // a family resolved AND it has corpus pages → promptBlock is non-null
  | "missed-unmapped" // the agent maps to no profession family
  | "missed-empty-corpus" // the family resolved but has no published corpus pages
  | "error"; // a DB read failed (fail-open — caller still proceeds without corpus)

export type ProfessionCorpusPageExcerpt = {
  slug: string;
  title: string;
  abstract: string | null;
  /** Bounded, whitespace-normalised body preview for the prompt. */
  excerpt: string;
  /** Lexical relevance score against the query (0 when nothing overlapped). */
  score: number;
};

export type ProfessionCorpusContext = {
  status: ProfessionCorpusStatus;
  professionKey: string | null;
  familyLabel: string | null;
  /** Deterministic `wsid-<professionKey>` profile id, or null when unmapped. */
  profileId: string | null;
  /** Top-ranked pages selected for the prompt (empty on a miss). */
  pages: ProfessionCorpusPageExcerpt[];
  /** Full, token-bounded prompt block. Null when there is nothing to inject. */
  promptBlock: string | null;
  /** Abstracts-only compact variant (arbitration compression fallback). */
  compactBlock: string | null;
  tokenCount: number;
  compactTokenCount: number;
  /**
   * True when the query carried ≥2 substantive terms yet NONE of them overlapped
   * any corpus page — i.e. the corpus exists but likely does not cover this
   * question. Drives a `low-relevance` growth-gap so corpora grow from real use.
   */
  lowRelevance: boolean;
  /** Normalised topic for gap dedupe (always set; basis = the query). */
  missingTopic: string;
  /** Suggested corpus/source to close a gap (registry checklist + first source). */
  suggestedSource: string | null;
};

// ─── DB client surface (structural — satisfied by PrismaClient + test fakes) ──

type WikiPageCorpusRow = {
  slug: string;
  title: string;
  abstract: string | null;
  body: string;
};

export type ProfessionCorpusClient = {
  wikiPage: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { slug: true; title: true; abstract: true; body: true };
    }): Promise<WikiPageCorpusRow[]>;
  };
};

// ─── Tunables ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_PAGES = 3;
const DEFAULT_EXCERPT_CHARS = 320;

// Lightweight token estimate (~4 chars/token) — matches context-arbitrator.
function estimateTokens(text: string | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ─── Lexical ranking (deterministic, dependency-free) ─────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had",
  "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how",
  "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its",
  "let", "put", "say", "she", "too", "use", "what", "when", "with", "this",
  "that", "from", "they", "would", "there", "their", "about", "which", "your",
  "have", "will", "into", "should", "could", "does", "doing", "need", "want",
  "please", "help", "tell", "show", "give", "make", "like", "want",
]);

/** Tokenise a query into deduped lowercase content terms (len ≥ 3, non-stopword). */
export function corpusQueryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
  }
  return terms;
}

type ScoredRow = WikiPageCorpusRow & { score: number; matchedTerms: number; checklistHits: number };

function slugTail(slug: string): string {
  // `professions/software-engineer/owasp-top-ten` → `owasp top ten`
  const last = slug.split("/").pop() ?? slug;
  return last.replace(/[^a-z0-9]+/gi, " ").toLowerCase();
}

/**
 * Rank corpus pages against the query by weighted field presence
 * (title ×3, abstract ×2, slug ×2, body ×1). Presence, not frequency, so a
 * long body cannot dominate a precise title match. Deterministic tie-break:
 * more distinct terms matched → more checklist keywords present → slug asc.
 */
export function rankCorpusPages(
  rows: WikiPageCorpusRow[],
  query: string,
  family: ProfessionFamily,
): ScoredRow[] {
  const terms = corpusQueryTerms(query);
  const checklistTokens = new Set(
    family.coverageChecklist.flatMap((c) => c.split(/[^a-z0-9]+/i).map((t) => t.toLowerCase())),
  );

  const scored: ScoredRow[] = rows.map((row) => {
    const title = row.title.toLowerCase();
    const abstract = (row.abstract ?? "").toLowerCase();
    const slug = slugTail(row.slug);
    const body = row.body.toLowerCase();

    let score = 0;
    let matchedTerms = 0;
    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) termScore += 3;
      if (abstract.includes(term)) termScore += 2;
      if (slug.includes(term)) termScore += 2;
      if (body.includes(term)) termScore += 1;
      if (termScore > 0) matchedTerms += 1;
      score += termScore;
    }

    let checklistHits = 0;
    for (const term of terms) {
      if (checklistTokens.has(term)) checklistHits += 1;
    }

    return { ...row, score, matchedTerms, checklistHits };
  });

  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.matchedTerms !== a.matchedTerms) return b.matchedTerms - a.matchedTerms;
    if (b.checklistHits !== a.checklistHits) return b.checklistHits - a.checklistHits;
    return a.slug.localeCompare(b.slug); // stable, deterministic final tie-break
  });
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function boundedExcerpt(body: string, maxChars: number): string {
  const normalised = body.replace(/\s+/g, " ").trim();
  if (normalised.length <= maxChars) return normalised;
  return normalised.slice(0, maxChars).replace(/\s+\S*$/, "") + "…";
}

function formatFullBlock(family: ProfessionFamily, pages: ProfessionCorpusPageExcerpt[]): string {
  const lines = [
    `PROFESSION CORPUS — ${family.label} (your professional knowledge base; cite pages by their slug):`,
  ];
  for (const page of pages) {
    lines.push(`- ${page.title} [${page.slug}]`);
    if (page.abstract) lines.push(`  ${page.abstract.replace(/\s+/g, " ").trim()}`);
    if (page.excerpt) lines.push(`  ${page.excerpt}`);
  }
  lines.push(
    "Ground craft and professional-practice answers in this corpus before generic recall. " +
      "If it does not cover the question, say so plainly instead of inventing an answer.",
  );
  return lines.join("\n");
}

function formatCompactBlock(family: ProfessionFamily, pages: ProfessionCorpusPageExcerpt[]): string {
  const titles = pages.map((p) => `${p.title} [${p.slug}]`).join("; ");
  return `PROFESSION CORPUS — ${family.label}: ${titles}. Cite by slug; ground craft answers here first.`;
}

// ─── Gap suggestion ───────────────────────────────────────────────────────────

/** Trailing characters stripped from a normalised topic (punctuation + space). */
const CORPUS_TOPIC_TRAILING = "?!. ";

/**
 * Normalise a query into a stable, human-readable topic (dedupe basis).
 *
 * The trailing strip is a linear char-walk, NOT an anchored regex like
 * `/[?!.]+$/` — that pattern is a polynomial-ReDoS vector on user-controlled
 * input (CodeQL js/polynomial-redos), the same reason `normalizeGapTopic`
 * (wiki/coverage-gap.ts) walks instead of matching.
 */
export function normalizeCorpusTopic(query: string): string {
  const collapsed = query.trim().toLowerCase().replace(/\s+/g, " ");
  let end = collapsed.length;
  while (end > 0 && CORPUS_TOPIC_TRAILING.includes(collapsed.charAt(end - 1))) {
    end--;
  }
  return collapsed.slice(0, end).slice(0, 160);
}

function suggestSourceForFamily(family: ProfessionFamily): string {
  const checklist = family.coverageChecklist.slice(0, 4).join(", ");
  const source = family.sources[0];
  const sourceHint = source ? ` Candidate source: ${source.name} (${source.url}).` : "";
  return `Seed corpus covering: ${checklist}.${sourceHint}`;
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

function missContext(
  status: Exclude<ProfessionCorpusStatus, "injected">,
  family: ProfessionFamily | null,
  query: string,
): ProfessionCorpusContext {
  return {
    status,
    professionKey: family?.professionKey ?? null,
    familyLabel: family?.label ?? null,
    profileId: family ? professionProfileId(family.professionKey) : null,
    pages: [],
    promptBlock: null,
    compactBlock: null,
    tokenCount: 0,
    compactTokenCount: 0,
    lowRelevance: false,
    missingTopic: normalizeCorpusTopic(query),
    suggestedSource: family ? suggestSourceForFamily(family) : null,
  };
}

/**
 * Resolve prompt-ready profession-corpus context for a coworker turn.
 *
 * Always returns (fail-open): on a miss or DB error the caller still assembles a
 * prompt — just without corpus — and records the miss as evidence. `status`
 * tells the caller which evidence to record.
 */
export async function resolveProfessionCorpusContext(input: {
  db: ProfessionCorpusClient;
  identity: ProfessionAgentIdentity;
  query: string;
  maxPages?: number;
  excerptChars?: number;
}): Promise<ProfessionCorpusContext> {
  const family = findProfessionFamilyForAgentIdentity(input.identity);
  if (!family) return missContext("missed-unmapped", null, input.query);

  let rows: WikiPageCorpusRow[];
  try {
    rows = await input.db.wikiPage.findMany({
      where: {
        slug: { startsWith: `professions/${family.professionKey}/` },
        status: "published",
      },
      select: { slug: true, title: true, abstract: true, body: true },
    });
  } catch {
    return missContext("error", family, input.query);
  }

  if (rows.length === 0) return missContext("missed-empty-corpus", family, input.query);

  const ranked = rankCorpusPages(rows, input.query, family);
  const top = ranked.slice(0, input.maxPages ?? DEFAULT_MAX_PAGES);
  const excerptChars = input.excerptChars ?? DEFAULT_EXCERPT_CHARS;

  const pages: ProfessionCorpusPageExcerpt[] = top.map((r) => ({
    slug: r.slug,
    title: r.title,
    abstract: r.abstract,
    excerpt: boundedExcerpt(r.body, excerptChars),
    score: r.score,
  }));

  const promptBlock = formatFullBlock(family, pages);
  const compactBlock = formatCompactBlock(family, pages);

  // Low-relevance signal: a real (≥2 content terms) question that overlapped
  // nothing in the corpus. The corpus is still injected (professional grounding
  // is always relevant), but the gap is captured so the corpus can grow.
  const terms = corpusQueryTerms(input.query);
  const lowRelevance = terms.length >= 2 && ranked.every((r) => r.score === 0);

  return {
    status: "injected",
    professionKey: family.professionKey,
    familyLabel: family.label,
    profileId: professionProfileId(family.professionKey),
    pages,
    promptBlock,
    compactBlock,
    tokenCount: estimateTokens(promptBlock),
    compactTokenCount: estimateTokens(compactBlock),
    lowRelevance,
    missingTopic: normalizeCorpusTopic(input.query),
    suggestedSource: lowRelevance ? suggestSourceForFamily(family) : null,
  };
}
