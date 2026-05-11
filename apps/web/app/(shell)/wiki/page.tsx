// EP-WIKI-001 Phase 6a: global wiki browse page.
// Shows kernel pages + the platform organization's overlay rows.
// Server component; queries Prisma directly.

import { prisma } from "@dpf/db";

import { WikiPageList, type WikiPageListItem } from "@/components/wiki/WikiPageList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wiki",
};

type SearchParams = Promise<{
  kind?: string;
  status?: string;
}>;

export default async function WikiBrowsePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;

  // Determine the platform organization id (DPF runs as a single-org install
  // — see (shell)/layout.tsx for the same pattern). Wiki rows are scoped to
  // either the kernel (organizationId IS NULL) or this org's overlay.
  const organization = await prisma.organization.findFirst({ select: { id: true } });
  const organizationId = organization?.id ?? null;

  const where: Record<string, unknown> = {
    OR: organizationId
      ? [{ organizationId }, { organizationId: null }]
      : [{ organizationId: null }],
  };

  // Default to published; ?status=all surfaces drafts and review-needed.
  const statusFilter = sp.status ?? "published";
  if (statusFilter !== "all") {
    where.status = statusFilter;
  }
  if (sp.kind) {
    where.pageKind = sp.kind;
  }

  const pages = (await prisma.wikiPage.findMany({
    where,
    select: {
      id: true,
      slug: true,
      title: true,
      pageKind: true,
      status: true,
      isKernel: true,
      abstract: true,
    },
    orderBy: [{ pageKind: "asc" }, { title: "asc" }],
  })) as WikiPageListItem[];

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          Wiki
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Founder kernel and per-org overlay. Kernel pages ship with the platform;
          overlay pages live alongside.
        </p>
      </header>

      <WikiPageList pages={pages} />
    </div>
  );
}
