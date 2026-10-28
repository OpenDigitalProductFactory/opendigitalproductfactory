// BI-4EAFF7AC: what links to a wiki page, and what names it without linking.
//
// Spec: docs/superpowers/specs/2026-10-14-knowledge-linking-design.md §4.2–4.3,
// under the scope rules of §2. The rule that shapes everything here is R1: a link
// never grants access. Every row, and every count, comes only from pages this
// reader may open. An unreadable page is left out entirely, with no placeholder and
// no "1 hidden" count.
//
// The reader is explicit (`WikiReader`) rather than read from globals. That way the
// organization seam (reader-organization.ts) and the profession-family seam
// (BI-825D3487, amended to JSI families) can tighten without this module changing.

import { findMention, mentionTerms } from "./link-mention";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAction<TResult = unknown> = (args: any) => Promise<TResult>;

export type WikiBacklinksClient = {
  wikiPageLink: { findMany: PrismaAction };
  wikiPage: { findMany: PrismaAction };
};

/** Who is reading, as the read paths need it. */
export type WikiReader = {
  /** The reader's organization; null means no organization pages are readable. */
  organizationId: string | null;
  /** Profession families the reader may read; null means no family filter is in force yet. */
  professionFamilies: ReadonlySet<string> | null;
  /** The reader's own profession family, ranked first when known. */
  familyKey: string | null;
};

export type WikiBacklinkPage = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  organizationId: string | null;
  kernelPageId: string | null;
  body: string;
};

export type WikiBacklinkScope = "profession-own" | "organization" | "platform" | "profession";

export type WikiBacklinkRow = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  scope: WikiBacklinkScope;
  href: string;
  context: string | null;
  /** On an override page: whether the link points at this page or at the kernel page it overrides. */
  via: "this-page" | "kernel-page";
};

export type WikiBacklinkGroup = { scope: WikiBacklinkScope; label: string; rows: WikiBacklinkRow[] };

export type WikiUnlinkedMention = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  scope: WikiBacklinkScope;
  href: string;
  context: string | null;
  /** Opens the overlay editor with the mention pre-wrapped; null where the page is not the reader's to edit. */
  linkItHref: string | null;
};

export type WikiBacklinks = {
  linkedFrom: WikiBacklinkGroup[];
  linkedFromCount: number;
  unlinkedMentions: WikiUnlinkedMention[];
};

const SCOPE_LABELS: Record<WikiBacklinkScope, string> = {
  "profession-own": "Your profession",
  organization: "Your organization",
  platform: "Platform",
  profession: "Professions",
};
const SCOPE_ORDER: WikiBacklinkScope[] = ["profession-own", "organization", "platform", "profession"];
const MENTION_CANDIDATE_CAP = 200;
const MENTION_CAP = 20;

const PAGE_SELECT = {
  id: true,
  slug: true,
  title: true,
  pageKind: true,
  status: true,
  isKernel: true,
  organizationId: true,
  kernelPageId: true,
  body: true,
} as const;

/** The profession family a slug belongs to (`professions/<family>/…`), if any. */
export function professionFamilyKey(slug: string): string | null {
  return /^professions\/([^/]+)\//.exec(slug)?.[1] ?? null;
}

/**
 * R1/R2 for wiki pages: a reader opens kernel pages, profession pages in their
 * families, and their own organization's pages. A reader with no organization
 * opens no organization page.
 */
export function canReadWikiPage(reader: WikiReader, page: { slug: string; organizationId: string | null }): boolean {
  if (page.organizationId !== null) return page.organizationId === reader.organizationId;
  const family = professionFamilyKey(page.slug);
  if (family !== null && reader.professionFamilies !== null) return reader.professionFamilies.has(family);
  return true;
}

function scopeOf(reader: WikiReader, page: { slug: string; organizationId: string | null }): WikiBacklinkScope {
  if (page.organizationId !== null) return "organization";
  const family = professionFamilyKey(page.slug);
  if (family === null) return "platform";
  return family === reader.familyKey ? "profession-own" : "profession";
}

/** Organization filter pushed into SQL; the family seam is applied in code after it. */
function organizationScopeWhere(reader: WikiReader) {
  return reader.organizationId === null
    ? { organizationId: null }
    : { OR: [{ organizationId: null }, { organizationId: reader.organizationId }] };
}

const HTML_ENTITIES: Record<string, string> = { "&#39;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">" };

/** Readable text for a snippet: links shown by their label, the target by its title. */
function plainText(markdown: string, target: { slug: string; title: string }): string {
  return markdown
    .replace(/\[\[([^\]|\n]*)\|([^\]\n]*)\]\]/g, "$2")
    .replace(/\[\[([^\]\n]*)\]\]/g, (_m, slug: string) =>
      slug === target.slug ? target.title : (slug.split("/").pop() ?? slug).replace(/-/g, " "),
    )
    .replace(/&#39;|&quot;|&amp;|&lt;|&gt;/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 80;

/** About one line of prose around `index`, cut at word boundaries. */
function snippetAround(body: string, index: number, length: number, target: { slug: string; title: string }): string {
  let start = Math.max(0, index - SNIPPET_BEFORE);
  let end = Math.min(body.length, index + length + SNIPPET_AFTER);
  if (start > 0) {
    const space = body.indexOf(" ", start);
    if (space >= 0 && space < index) start = space + 1;
  }
  if (end < body.length) {
    const space = body.lastIndexOf(" ", end);
    if (space > index + length) end = space;
  }
  const text = plainText(body.slice(start, end), target);
  return `${start > 0 ? "…" : ""}${text}${end < body.length ? "…" : ""}`;
}

function linkContext(body: string, target: { slug: string; title: string }): string | null {
  let from = 0;
  for (;;) {
    const index = body.indexOf(`[[${target.slug}`, from);
    if (index < 0) return null;
    const next = body[index + 2 + target.slug.length];
    if (next === "]" || next === "|") return snippetAround(body, index, target.slug.length + 4, target);
    from = index + 1;
  }
}

function hrefFor(slug: string): string {
  return `/coworker-decisions/${slug}`;
}

function bySortKey<T extends { scope: WikiBacklinkScope; title: string }>(a: T, b: T): number {
  const scope = SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope);
  return scope !== 0 ? scope : a.title.localeCompare(b.title);
}

/** Inbound links and unlinked mentions for `page`, limited to what `reader` may open. */
export async function loadWikiBacklinks(
  db: WikiBacklinksClient,
  input: { page: WikiBacklinkPage; reader: WikiReader },
): Promise<WikiBacklinks> {
  const { page, reader } = input;
  const targetIds = page.kernelPageId ? [page.id, page.kernelPageId] : [page.id];

  const inbound = (await db.wikiPageLink.findMany({
    where: { toPageId: { in: targetIds } },
    select: { toPageId: true, fromPage: { select: PAGE_SELECT } },
  })) as Array<{ toPageId: string; fromPage: WikiBacklinkPage }>;

  const rowsById = new Map<string, WikiBacklinkRow>();
  for (const link of inbound) {
    const source = link.fromPage;
    if (targetIds.includes(source.id) || !canReadWikiPage(reader, source)) continue;
    const via = link.toPageId === page.id ? "this-page" : "kernel-page";
    if (rowsById.get(source.id)?.via === "this-page") continue;
    rowsById.set(source.id, {
      id: source.id,
      slug: source.slug,
      title: source.title,
      pageKind: source.pageKind,
      scope: scopeOf(reader, source),
      href: hrefFor(source.slug),
      context: linkContext(source.body, page),
      via,
    });
  }
  const rows = [...rowsById.values()].sort(bySortKey);
  const linkedFrom: WikiBacklinkGroup[] = SCOPE_ORDER.map((scope) => ({
    scope,
    label: SCOPE_LABELS[scope],
    rows: rows.filter((r) => r.scope === scope),
  })).filter((g) => g.rows.length > 0);

  // Every page that links here, readable or not, is excluded from mentions: a page
  // that already links is not an unlinked mention, whoever can see it.
  const linkingIds = new Set(inbound.map((l) => l.fromPage.id));
  const unlinkedMentions = await loadUnlinkedMentions(db, page, reader, [...targetIds, ...linkingIds]);

  return { linkedFrom, linkedFromCount: rows.length, unlinkedMentions };
}

async function loadUnlinkedMentions(
  db: WikiBacklinksClient,
  page: WikiBacklinkPage,
  reader: WikiReader,
  excludedIds: string[],
): Promise<WikiUnlinkedMention[]> {
  const terms = mentionTerms(page);
  if (terms.length === 0) return [];

  // A plain ILIKE over the organization-scoped pages; the trigram index of
  // spec §4.3 is deferred to BI-FC5E4832.
  const candidates = (await db.wikiPage.findMany({
    where: {
      AND: [
        { id: { notIn: excludedIds } },
        organizationScopeWhere(reader),
        { OR: terms.map((term) => ({ body: { contains: term, mode: "insensitive" } })) },
      ],
    },
    select: PAGE_SELECT,
    take: MENTION_CANDIDATE_CAP,
  })) as WikiBacklinkPage[];

  const mentions: WikiUnlinkedMention[] = [];
  for (const source of candidates) {
    if (!canReadWikiPage(reader, source)) continue;
    const mention = findMention(source.body, terms);
    if (!mention) continue;
    const editable = !source.isKernel && source.organizationId !== null && source.organizationId === reader.organizationId;
    mentions.push({
      id: source.id,
      slug: source.slug,
      title: source.title,
      pageKind: source.pageKind,
      scope: scopeOf(reader, source),
      href: hrefFor(source.slug),
      context: snippetAround(source.body, mention.index, mention.text.length, page),
      linkItHref: editable ? `/coworker-decisions/edit/${source.slug}?linkTo=${encodeURIComponent(page.slug)}` : null,
    });
  }
  return mentions.sort(bySortKey).slice(0, MENTION_CAP);
}
