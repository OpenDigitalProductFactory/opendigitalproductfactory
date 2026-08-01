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
import { normalizeVariantAxes } from "@/lib/coworker-record/variant-axes";

const ARCHETYPE_NEUTRAL = "universal";
const JURISDICTION_NEUTRAL = "global";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ProfessionCorpusStatus =
  | "injected" // a family resolved AND it has corpus pages → promptBlock is non-null
  | "missed-unmapped" // the agent maps to no profession family
  | "missed-empty-corpus" // the family resolved but has no published corpus pages
  | "missed-empty-applicable-corpus" // pages exist, but none apply to this install variant
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
  /** WikiPage.metadata blob carrying the WSID variant axes. */
  metadata: unknown;
};

export type ProfessionCorpusClient = {
  wikiPage: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { slug: true; title: true; abstract: true; body: true; metadata: true };
    }): Promise<WikiPageCorpusRow[]>;
  };
};

/**
 * The install's regional profile. Region is not one tag: an install operates in
 * some jurisdictions, sells to others, and employs in others — and different
 * obligations key off different dimensions (sales-tax/marketing-consent off
 * where the customer is; employment law off where employees work; data
 * sovereignty off where data subjects are). Each set lists jurisdiction slugs
 * (PROFESSION_JURISDICTIONS). An empty/omitted set means "not declared" and does
 * NOT filter that dimension (no regression).
 */
export type InstallRegionalProfile = {
  /** Where the business is established — business licensing, corporate tax/nexus. */
  operatesIn?: string[];
  /** Where customers/recipients are — sales tax/VAT, marketing consent, consumer law. */
  sellsTo?: string[];
  /** Where employees do the work — employment law, payroll tax, workers' comp. */
  employsIn?: string[];
  /** Where data subjects are / data must reside — data sovereignty. */
  dataResidency?: string[];
};

/**
 * The install's resolved variant context. Selects which corpus slice a coworker
 * is served. `archetype` defaults to `"universal"` (an install with no business
 * archetype gets only archetype-neutral pages — never another archetype's
 * craft). `regional` carries the multi-dimensional jurisdiction profile; a
 * jurisdiction-specific page is served only when the install's set FOR THAT
 * PAGE'S BASIS includes the page's jurisdiction. `global`-basis pages (e.g.
 * PCI-DSS) always apply.
 */
export type ProfessionCorpusInstallContext = {
  archetype?: string | null;
  regional?: InstallRegionalProfile;
};

/** Normalised variant axes for a single page (output of normalizeVariantAxes). */
type PageVariantAxes = { archetypes: string[]; jurisdictions: string[]; basis: string };

/** The install's declared jurisdiction set for a page's basis (empty = undeclared). */
function installSetForBasis(regional: InstallRegionalProfile, basis: string): string[] {
  switch (basis) {
    case "operating":
      return regional.operatesIn ?? [];
    case "selling":
      return regional.sellsTo ?? [];
    case "employing":
      return regional.employsIn ?? [];
    case "data-residency":
      return regional.dataResidency ?? [];
    default:
      return []; // "global" is handled before this is consulted
  }
}

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

type ScoredRow = WikiPageCorpusRow & {
  score: number;
  matchedTerms: number;
  checklistHits: number;
  /** Bonus for matching the install's archetype/jurisdiction (ranks tailored doctrine first). */
  variantBoost: number;
};

/**
 * Does this page's jurisdiction apply to the install, given the page's basis?
 * Region-neutral pages (global basis, or `global` in the jurisdiction list)
 * always apply. Otherwise the page's jurisdiction must intersect the install's
 * declared set FOR THAT BASIS — so a US business selling into the EU still gets
 * EU marketing-consent doctrine (via `sellsTo`) even though it operates only in
 * the US. An UNDECLARED install dimension (empty set) does not filter (no
 * regression for installs that haven't captured that part of their profile).
 */
function jurisdictionEligible(axes: PageVariantAxes, regional: InstallRegionalProfile): boolean {
  if (axes.basis === "global" || axes.jurisdictions.includes(JURISDICTION_NEUTRAL)) return true;
  const installSet = installSetForBasis(regional, axes.basis);
  if (installSet.length === 0) return true; // dimension not declared → don't filter
  return axes.jurisdictions.some((j) => installSet.includes(j));
}

/**
 * Is this page eligible to serve the given install? Archetype-specific pages are
 * served ONLY to a matching install (a retail install never sees HVAC craft);
 * jurisdiction-specific pages are filtered per their basis against the install's
 * regional profile (see {@link jurisdictionEligible}).
 */
export function pageEligibleForInstall(
  axes: PageVariantAxes,
  install: ProfessionCorpusInstallContext,
): boolean {
  const installArch = install.archetype || ARCHETYPE_NEUTRAL;
  const archOk =
    axes.archetypes.includes(ARCHETYPE_NEUTRAL) || axes.archetypes.includes(installArch);

  return archOk && jurisdictionEligible(axes, install.regional ?? {});
}

/** Ranking bonus for a page that SPECIFICALLY matches the install's variant. */
function variantBoostFor(axes: PageVariantAxes, install: ProfessionCorpusInstallContext): number {
  let boost = 0;
  if (
    install.archetype &&
    install.archetype !== ARCHETYPE_NEUTRAL &&
    axes.archetypes.includes(install.archetype)
  ) {
    boost += 3;
  }
  // Jurisdiction boost: the page specifically matches the install's set for its basis.
  if (axes.basis !== "global" && !axes.jurisdictions.includes(JURISDICTION_NEUTRAL)) {
    const installSet = installSetForBasis(install.regional ?? {}, axes.basis);
    if (axes.jurisdictions.some((j) => installSet.includes(j))) boost += 3;
  }
  return boost;
}

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
  install: ProfessionCorpusInstallContext = {},
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

    const variantBoost = variantBoostFor(normalizeVariantAxes(row.metadata), install);

    // `score` stays pure-lexical (drives the low-relevance gap signal); the
    // variant boost is a separate axis folded into the sort only.
    return { ...row, score, matchedTerms, checklistHits, variantBoost };
  });

  return scored.sort((a, b) => {
    const aRank = a.score + a.variantBoost;
    const bRank = b.score + b.variantBoost;
    if (bRank !== aRank) return bRank - aRank;
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
  /** The install's resolved archetype/jurisdiction — selects the corpus slice. */
  installContext?: ProfessionCorpusInstallContext;
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
      select: { slug: true, title: true, abstract: true, body: true, metadata: true },
    });
  } catch {
    return missContext("error", family, input.query);
  }

  if (rows.length === 0) return missContext("missed-empty-corpus", family, input.query);

  // Variant selection: keep pages eligible for this install (archetype-specific
  // craft only to a matching install; jurisdiction filtered only when declared).
  // Fail closed across archetypes: an empty applicable slice is a corpus gap,
  // never permission to inject another industry's craft.
  const install = input.installContext ?? {};
  const eligible = rows.filter((r) => pageEligibleForInstall(normalizeVariantAxes(r.metadata), install));
  if (eligible.length === 0) {
    return missContext("missed-empty-applicable-corpus", family, input.query);
  }
  const usable = eligible;

  const ranked = rankCorpusPages(usable, input.query, family, install);
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
