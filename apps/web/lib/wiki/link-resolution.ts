// BI-2F7BE778: the one dangling-link rule. Moved out of `detectDanglingXrefs`
// (lint-detectors.ts) so the wiki editor checks a draft by exactly the rule
// lint applies after the fact (spec 2026-10-14 knowledge-linking §7).
//
// The rule is unchanged: a link from a null-organization page (kernel or
// profession) resolves against null-organization slugs; a link from an
// organization page resolves against that organization's slugs plus the
// null-organization slugs (kernel fallback). Links are read by the shared
// extractor (`@dpf/db/wiki-frontmatter`), so code spans and fences never count.
//
// Pure and dependency-free beyond the extractor, so the client editor can run it.

import { extractWikilinkOccurrences, extractWikilinks } from "@dpf/db/wiki-frontmatter";

export type WikiSlugIndex = {
  /** Slugs of pages with no organization: kernel and profession pages. */
  sharedSlugs: ReadonlySet<string>;
  /** Slugs of each organization's own pages. */
  organizationSlugs: ReadonlyMap<string, ReadonlySet<string>>;
};

export function buildWikiSlugIndex(pages: ReadonlyArray<{ slug: string; organizationId: string | null }>): WikiSlugIndex {
  const sharedSlugs = new Set<string>();
  const organizationSlugs = new Map<string, Set<string>>();
  for (const page of pages) {
    if (page.organizationId === null) {
      sharedSlugs.add(page.slug);
      continue;
    }
    let set = organizationSlugs.get(page.organizationId);
    if (!set) {
      set = new Set<string>();
      organizationSlugs.set(page.organizationId, set);
    }
    set.add(page.slug);
  }
  return { sharedSlugs, organizationSlugs };
}

/** The slugs a link written on a page of `organizationId` resolves against. */
export function resolvableSlugs(index: WikiSlugIndex, organizationId: string | null): ReadonlySet<string> {
  if (organizationId === null) return index.sharedSlugs;
  return new Set<string>([...(index.organizationSlugs.get(organizationId) ?? []), ...index.sharedSlugs]);
}

/** Distinct link targets in `body` that do not resolve, in first-seen order. */
export function danglingTargets(body: string, slugs: ReadonlySet<string>): string[] {
  return extractWikilinks(body).filter((slug) => !slugs.has(slug));
}

export type DanglingLink = { slug: string; line: number };

/** Each unresolved link with its line; a target repeated on one line is listed once. */
export function danglingLinks(body: string, slugs: ReadonlySet<string>): DanglingLink[] {
  const seen = new Set<string>();
  const links: DanglingLink[] = [];
  for (const { slug, line } of extractWikilinkOccurrences(body)) {
    if (slugs.has(slug)) continue;
    const key = `${line}\u0000${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ slug, line });
  }
  return links;
}
