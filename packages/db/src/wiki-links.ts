// BI-23900D0A: the one writer for a wiki page's out-links.
//
// A page body is the system of record for the pages it links to; `WikiPageLink`
// and the `LINKS_TO` graph mirror are projections of it. Before this module the
// projection was wrong in three ways: labelled links (`[[slug|label]]`) were never
// extracted, an organization page's link to a kernel or profession page never
// resolved (the lookup matched the exact organizationId only), and the writers
// only upserted, so a link removed from a body stayed forever. Two copies of the
// commit-path writer existed, and five other body writers wrote no links at all.
//
// Every body write now calls `replaceWikiPageOutLinks`, and the boot projection
// refresh calls `reconcileWikiPageLinks` (the re-runnable backfill), so the rows
// converge on what the bodies say on every install.
//
// Spec: docs/superpowers/specs/2026-10-14-knowledge-linking-design.md §4.1.

import { extractWikilinks } from "./wiki-frontmatter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAction<TResult = unknown> = (args: any) => Promise<TResult>;

/** The slice of the Prisma client this module touches; a $transaction client fits. */
export type WikiLinkClient = {
  wikiPage: { findMany: PrismaAction };
  wikiPageLink: {
    findMany: PrismaAction;
    deleteMany: PrismaAction;
    createMany: PrismaAction;
  };
};

/**
 * Projects a page's resolved out-links into the graph mirror. Passed in rather
 * than imported so this module stays free of the database client and can ride
 * the `@dpf/db/wiki-store` subpath; the projector is `projectWikiLinksToGraph`
 * in graph-sync.ts.
 */
export type ProjectWikiLinks = (fromPageId: string, toPageIds: string[]) => Promise<void>;

export type ReplaceWikiPageOutLinksResult = {
  toPageIds: string[];
  added: number;
  removed: number;
  /** Set when the graph projection failed; the WikiPageLink rows still stand. */
  projectionError?: string;
};

/**
 * Resolve link slugs for a page in `organizationId` (null = kernel or
 * profession page). The page's own organization wins, then the null-organization
 * corpus. Null-organization slugs are unique (`WikiPage_kernel_slug_key`, a
 * partial unique index), so the kernel and profession corpora cannot both hold a
 * slug, and another organization's pages are never candidates.
 */
async function resolveWikiLinkTargets(
  db: WikiLinkClient,
  organizationId: string | null,
  slugs: string[],
): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = (await db.wikiPage.findMany({
    where:
      organizationId === null
        ? { slug: { in: slugs }, organizationId: null }
        : { slug: { in: slugs }, OR: [{ organizationId }, { organizationId: null }] },
    select: { id: true, slug: true, organizationId: true },
  })) as Array<{ id: string; slug: string; organizationId: string | null }>;

  const bySlug = new Map<string, string>();
  for (const row of rows) {
    const own = row.organizationId !== null;
    if (!bySlug.has(row.slug) || own) bySlug.set(row.slug, row.id);
  }
  return bySlug;
}

/**
 * Make the page's stored out-links exactly the links its body names, then
 * project them. Idempotent: a second call with the same body changes nothing.
 * A graph-projection failure is reported, never thrown, because the mirror is
 * rebuildable and the rows are the record.
 */
export async function replaceWikiPageOutLinks(
  db: WikiLinkClient,
  page: { pageId: string; organizationId: string | null; body: string },
  project: ProjectWikiLinks,
): Promise<ReplaceWikiPageOutLinksResult> {
  // Source citations live on WikiPageSource, not in the link graph.
  const slugs = extractWikilinks(page.body).filter((s) => !s.startsWith("raw-sources/"));
  const resolved = await resolveWikiLinkTargets(db, page.organizationId, slugs);
  const wanted = [...new Set(slugs.map((s) => resolved.get(s)).filter((id): id is string => !!id))].filter(
    (id) => id !== page.pageId,
  );

  const existing = new Set(
    ((await db.wikiPageLink.findMany({
      where: { fromPageId: page.pageId },
      select: { toPageId: true },
    })) as Array<{ toPageId: string }>).map((l) => l.toPageId),
  );
  const toRemove = [...existing].filter((id) => !wanted.includes(id));
  const toAdd = wanted.filter((id) => !existing.has(id));

  if (toRemove.length > 0) {
    await db.wikiPageLink.deleteMany({ where: { fromPageId: page.pageId, toPageId: { in: toRemove } } });
  }
  if (toAdd.length > 0) {
    await db.wikiPageLink.createMany({
      data: toAdd.map((toPageId) => ({ fromPageId: page.pageId, toPageId })),
      skipDuplicates: true,
    });
  }

  const result: ReplaceWikiPageOutLinksResult = { toPageIds: wanted, added: toAdd.length, removed: toRemove.length };
  try {
    await project(page.pageId, wanted);
  } catch (err) {
    result.projectionError = err instanceof Error ? err.message : String(err);
  }
  return result;
}

export type ReconcileWikiPageLinksResult = {
  pages: number;
  added: number;
  removed: number;
  projectionErrors: number;
};

/**
 * The backfill: re-derive every page's out-links from its body. Safe to run on
 * every boot; a run over unchanged bodies adds and removes nothing.
 */
export async function reconcileWikiPageLinks(
  db: WikiLinkClient,
  opts: { pageSize?: number; project: ProjectWikiLinks },
): Promise<ReconcileWikiPageLinksResult> {
  const pageSize = opts.pageSize ?? 200;
  const totals: ReconcileWikiPageLinksResult = { pages: 0, added: 0, removed: 0, projectionErrors: 0 };
  let after: string | null = null;
  for (;;) {
    const batch = (await db.wikiPage.findMany({
      where: after === null ? {} : { id: { gt: after } },
      select: { id: true, organizationId: true, body: true },
      orderBy: { id: "asc" },
      take: pageSize,
    })) as Array<{ id: string; organizationId: string | null; body: string }>;
    if (batch.length === 0) break;
    for (const page of batch) {
      const r = await replaceWikiPageOutLinks(
        db,
        { pageId: page.id, organizationId: page.organizationId, body: page.body },
        opts.project,
      );
      totals.pages += 1;
      totals.added += r.added;
      totals.removed += r.removed;
      if (r.projectionError) totals.projectionErrors += 1;
    }
    after = batch[batch.length - 1]!.id;
    if (batch.length < pageSize) break;
  }
  return totals;
}
