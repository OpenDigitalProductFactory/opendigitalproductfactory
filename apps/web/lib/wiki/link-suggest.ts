// BI-2F7BE778: the pages the wiki editor offers after `[[` (spec 2026-10-14
// knowledge-linking §7, under §2 R1, R4, R5 and R7).
//
// - R1: a suggestion is a read path. Every row passes the backlinks reader rule
//   (`canReadWikiPage`) for this reader, after the SQL filter, so an unreadable
//   page is never offered and never counted.
// - R4: links cross scopes in one direction. An organization page may link
//   kernel, profession and organization pages; a profession page only
//   profession and kernel pages.
// - R7: kernel pages are not edited in the runtime, so a kernel source is
//   offered nothing.
// - R5 ranking: the reader's own family first, then the kernel and the
//   organization, then other families; relevance orders each band.
//
// Matching is pg_trgm (installed) on title and slug. No trigram index is
// needed: the scan reads two short columns of a table of a few hundred rows
// after the organization filter. BI-FC5E4832 owns the GIN index on `body`.

import { canReadWikiPage, professionFamilyKey, type WikiReader } from "./backlinks";

export const LINK_SUGGESTION_LIMIT = 8;
/** Rows read before the R1/R4 filter, so filtering rarely leaves fewer than the limit. */
const CANDIDATE_CAP = 40;
/** Below this, a trigram score is noise; substring matches are kept regardless. */
const SIMILARITY_FLOOR = 0.2;

export type LinkScope = "kernel" | "profession" | "organization";

/** The scope a link written on this page starts from. */
export function linkSourceScope(page: { slug: string; organizationId: string | null; isKernel: boolean }): LinkScope {
  // An overlay written at a profession slug is craft content: it takes the
  // profession direction, so it is never pointed at organization records.
  if (professionFamilyKey(page.slug) !== null) return "profession";
  if (page.organizationId !== null) return "organization";
  return "kernel";
}

/** The source scope of an organization overlay at `slug`: what the wiki editor writes. */
export function overlayLinkSourceScope(slug: string): LinkScope {
  return professionFamilyKey(slug) !== null ? "profession" : "organization";
}

/** R4: which target scopes a source scope may link. */
export function allowedTargetScopes(source: LinkScope): LinkScope[] {
  switch (source) {
    case "organization":
      return ["kernel", "profession", "organization"];
    case "profession":
      return ["profession", "kernel"];
    case "kernel":
      return [];
  }
}

function targetScopeOf(page: { slug: string; organizationId: string | null }): LinkScope {
  if (page.organizationId !== null) return "organization";
  return professionFamilyKey(page.slug) !== null ? "profession" : "kernel";
}

export type LinkCandidate = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  organizationId: string | null;
  isKernel: boolean;
  kernelPageId: string | null;
};

export type LinkSuggestionScope = "profession-own" | "organization" | "platform" | "profession";

export type LinkSuggestion = {
  slug: string;
  title: string;
  pageKind: string;
  scope: LinkSuggestionScope;
};

/** The tagged-template `$queryRaw` of a Prisma client; every value is a bound parameter. */
export type LinkCandidateDb = {
  $queryRaw: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};

/** One SQL read: scope pushed into WHERE, ranked by trigram similarity on title and slug. */
export async function queryLinkCandidates(
  db: LinkCandidateDb,
  input: { query: string; organizationId: string | null; scopes: readonly LinkScope[] },
): Promise<LinkCandidate[]> {
  const kernel = input.scopes.includes("kernel");
  const profession = input.scopes.includes("profession");
  // Organization rows are asked for only when the direction allows them and the reader has one.
  const organizationId = input.scopes.includes("organization") ? input.organizationId : null;
  if (!kernel && !profession && organizationId === null) return [];

  const q = input.query.trim().toLowerCase();
  return db.$queryRaw<LinkCandidate[]>`
    SELECT "id", "slug", "title", "pageKind", "organizationId", "isKernel", "kernelPageId"
    FROM (
      SELECT "id", "slug", "title", "pageKind", "organizationId", "isKernel", "kernelPageId",
        GREATEST(
          similarity(lower("title"), ${q}),
          similarity(lower("slug"), ${q}),
          word_similarity(${q}, lower("title")),
          word_similarity(${q}, lower("slug"))
        ) AS score,
        (strpos(lower("title"), ${q}) = 1) AS title_prefix,
        (strpos(lower("title"), ${q}) > 0 OR strpos(lower("slug"), ${q}) > 0) AS has_match
      FROM "WikiPage"
      WHERE (${kernel}::boolean AND "organizationId" IS NULL AND "slug" NOT LIKE 'professions/%')
         OR (${profession}::boolean AND "organizationId" IS NULL AND "slug" LIKE 'professions/%')
         OR ("organizationId" IS NOT NULL AND "organizationId" = ${organizationId}::text)
    ) AS ranked
    WHERE has_match OR score > ${SIMILARITY_FLOOR}
    ORDER BY title_prefix DESC, has_match DESC, score DESC, "title" ASC
    LIMIT ${CANDIDATE_CAP}
  `;
}

function suggestionScope(reader: WikiReader, page: { slug: string; organizationId: string | null }): LinkSuggestionScope {
  if (page.organizationId !== null) return "organization";
  const family = professionFamilyKey(page.slug);
  if (family === null) return "platform";
  return family === reader.familyKey ? "profession-own" : "profession";
}

const RANK_BAND: Record<LinkSuggestionScope, number> = {
  "profession-own": 0,
  platform: 1,
  organization: 1,
  profession: 2,
};

/**
 * Filter candidates to what this reader may read and this source may link,
 * then rank and cap. Candidates arrive in relevance order; ranking is stable
 * within a band, so relevance still orders each band.
 */
export function selectLinkSuggestions(
  candidates: readonly LinkCandidate[],
  input: { reader: WikiReader; source: LinkScope; fromSlug: string; limit?: number },
): LinkSuggestion[] {
  const allowed = new Set(allowedTargetScopes(input.source));
  const readable = candidates.filter(
    (page) => page.slug !== input.fromSlug && canReadWikiPage(input.reader, page) && allowed.has(targetScopeOf(page)),
  );
  // An organization page masks the null-organization page at the same slug,
  // which is how the viewer resolves it.
  const bySlug = new Map<string, LinkCandidate>();
  for (const page of readable) {
    const existing = bySlug.get(page.slug);
    if (!existing || (existing.organizationId === null && page.organizationId !== null)) bySlug.set(page.slug, page);
  }
  const ordered = readable.filter((page) => bySlug.get(page.slug) === page);
  return ordered
    .map((page) => ({ slug: page.slug, title: page.title, pageKind: page.pageKind, scope: suggestionScope(input.reader, page) }))
    .map((row, position) => ({ row, position }))
    .sort((a, b) => RANK_BAND[a.row.scope] - RANK_BAND[b.row.scope] || a.position - b.position)
    .map(({ row }) => row)
    .slice(0, input.limit ?? LINK_SUGGESTION_LIMIT);
}
