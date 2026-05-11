// EP-WIKI-001 Phase 6a: wiki page detail viewer.
// Server component. Reads the page by (organizationId, slug) with
// kernel fallback per spec §3.3.

import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";

import { WikiPageViewer, type WikiPageDetail } from "@/components/wiki/WikiPageViewer";

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

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  const organizationId = organization?.id ?? null;

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

  return <WikiPageViewer page={detail} />;
}
