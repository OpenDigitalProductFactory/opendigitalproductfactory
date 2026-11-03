// EP-WIKI-001 Phase 6a: wiki page detail viewer.
// Server component. Reads the page by (organizationId, slug) with
// kernel fallback per spec §3.3.

import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";

import type { WikiBacklinksLabels } from "@/components/wiki/WikiBacklinksPanel";
import { WikiPageViewer, type WikiPageDetail } from "@/components/wiki/WikiPageViewer";
import { getT } from "@/lib/i18n/t.server";
import { loadWikiBacklinks, type WikiReader } from "@/lib/wiki/backlinks";
import { resolveReaderOrganizationId } from "@/lib/wiki/reader-organization";

export const dynamic = "force-dynamic";

const PAGE_INCLUDE = {
  sources: {
    include: {
      source: {
        select: {
          id: true,
          sourceKey: true,
          sourceType: true,
          title: true,
          authors: true,
          url: true,
          publishedAt: true,
        },
      },
    },
  },
} as const;

type Params = Promise<{ slug: string[] }>;

export default async function WikiPageDetailRoute({ params }: { params: Params }) {
  const { slug: slugParts } = await params;
  const slug = slugParts.join("/");

  // R2 (spec 2026-10-14 knowledge-linking §2): the reader's organization, from a
  // seam that fails closed on a multi-organization install, never "the first
  // organization" (BI-4EAFF7AC; session membership is BI-1B4AB42A).
  const organizationId = await resolveReaderOrganizationId(prisma);

  // findFirst rather than findUnique because Prisma's compound-key
  // findUnique doesn't accept `organizationId: null` for the kernel
  // pass — nullable compound keys narrow non-null in the type.
  // Pass A: org overlay (skipped when there's no current org).
  // Pass B: kernel fallback when the overlay didn't return a row.
  const orgRow = organizationId
    ? await prisma.wikiPage.findFirst({
        where: { organizationId, slug },
        include: PAGE_INCLUDE,
      })
    : null;

  const row =
    orgRow ??
    (await prisma.wikiPage.findFirst({
      where: { organizationId: null, slug },
      include: PAGE_INCLUDE,
    }));

  if (!row) notFound();

  const detail: WikiPageDetail = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    pageKind: row.pageKind,
    status: row.status,
    isKernel: row.isKernel,
    kernelVersion: row.kernelVersion,
    organizationId: row.organizationId,
    kernelPageId: row.kernelPageId,
    derivedFromKernelVersion: row.derivedFromKernelVersion,
    abstract: row.abstract,
    lastReviewedAt: row.lastReviewedAt,
    updatedAt: row.updatedAt,
    sources: row.sources.map((s) => ({
      id: s.source.id,
      sourceKey: s.source.sourceKey,
      sourceType: s.source.sourceType,
      title: s.source.title,
      authors: s.source.authors,
      url: s.source.url,
      publishedAt: s.source.publishedAt,
    })),
  };

  const reader: WikiReader = { organizationId, professionFamilies: null, familyKey: null };
  const backlinks = await loadWikiBacklinks(prisma, { page: row, reader });
  const t = await getT("wiki");
  const labels: WikiBacklinksLabels = {
    heading: t("backlinks.heading"),
    empty: t("backlinks.empty"),
    unlinkedMentions: t("backlinks.unlinkedMentions", { count: String(backlinks.unlinkedMentions.length) }),
    linkIt: t("backlinks.linkIt"),
    linksPlatformPage: t("backlinks.linksPlatformPage"),
    groups: {
      "profession-own": t("backlinks.groups.professionOwn"),
      organization: t("backlinks.groups.organization"),
      platform: t("backlinks.groups.platform"),
      profession: t("backlinks.groups.profession"),
    },
    scopes: {
      "profession-own": t("backlinks.scopes.profession"),
      organization: t("backlinks.scopes.organization"),
      platform: t("backlinks.scopes.platform"),
      profession: t("backlinks.scopes.profession"),
    },
  };

  return <WikiPageViewer page={detail} backlinks={{ data: backlinks, labels }} />;
}
