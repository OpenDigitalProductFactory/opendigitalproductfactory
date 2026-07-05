// EP-0AF96937 Phase 1: decision-governance landing.
// Reframes the former document-taxonomy "Wiki" landing around the three
// decision disciplines a business reasons about — WWMD (platform), WWWD
// (business), WSID (craft) — with derived health and See/Adjust/Review actions.
// The raw kernel material (principles/stances/heuristics/…) is retained below
// as a drill-in, not the front door.
// Server component; queries Prisma directly.

import Link from "next/link";
import { prisma } from "@dpf/db";

import { WikiPageList, type WikiPageListItem } from "@/components/wiki/WikiPageList";
import { DecisionDisciplineHub } from "@/components/wiki/DecisionDisciplineHub";
import { buildDisciplineCards } from "@/lib/wiki/decision-governance-hub";
import {
  WWMD_PLATFORM_PROFILE_ID,
  WWWD_ORGANIZATION_PROFILE_ID,
} from "@/lib/decision/caller-context";
import { resolveOrgProfileId } from "@/lib/decision-perspective/material";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Decision governance",
};

type SearchParams = Promise<{
  kind?: string;
  status?: string;
}>;

const UNRESOLVED = ["defer", "escalate"];

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

  // WWWD health must be read off the org's OWN profile (org-perspective-<orgId>,
  // seeded at onboarding — BI-230C9EF7/BI-44526F3E), not just the platform
  // fallback id: counting only the fallback made the hub show "no stance of
  // your own yet" even after the onboarding seed succeeded.
  const orgProfileId = organizationId
    ? await resolveOrgProfileId({ db: prisma, organizationId })
    : null;
  const wwwdProfileIds = orgProfileId
    ? [orgProfileId, WWWD_ORGANIZATION_PROFILE_ID]
    : [WWWD_ORGANIZATION_PROFILE_ID];

  // Derive discipline health + fetch the retained material list in parallel.
  const [
    pages,
    kernelPrincipleCount,
    kernelHeuristicCount,
    orgStanceMaterialCount,
    wwmdOpenReviews,
    wwwdOpenReviews,
    wsidActiveProfiles,
    wsidOpenReviews,
  ] = await Promise.all([
    prisma.wikiPage.findMany({
      where,
      select: {
        id: true,
        slug: true,
        title: true,
        pageKind: true,
        status: true,
        isKernel: true,
        abstract: true,
        principleTier: true,
        principleConsumerArchetype: true,
        principleConsumerContexts: true,
      },
      orderBy: [
        { pageKind: "asc" },
        { principleConsumerArchetype: "asc" },
        { principleTier: "asc" },
        { title: "asc" },
      ],
    }) as Promise<WikiPageListItem[]>,
    prisma.wikiPage.count({
      where: { organizationId: null, pageKind: "principle", status: "published" },
    }),
    prisma.wikiPage.count({
      where: { organizationId: null, pageKind: "heuristic", status: "published" },
    }),
    // The org has "its own stance" when its own WWWD profile (or, for
    // installs without one, the platform organization fallback) carries
    // material rows. 0 → "no stance of your own yet".
    prisma.perspectiveMaterial.count({
      where: { profileId: { in: wwwdProfileIds } },
    }),
    prisma.decisionInteraction.count({
      where: { outcomeType: { in: UNRESOLVED }, profileId: WWMD_PLATFORM_PROFILE_ID },
    }),
    prisma.decisionInteraction.count({
      where: { outcomeType: { in: UNRESOLVED }, profileId: { in: wwwdProfileIds } },
    }),
    prisma.decisionPerspectiveProfile.count({
      where: { kind: "profession", status: "active" },
    }),
    prisma.decisionInteraction.count({
      where: { outcomeType: { in: UNRESOLVED }, profileId: { startsWith: "wsid-" } },
    }),
  ]);

  const disciplineCards = buildDisciplineCards({
    kernelPrincipleCount,
    kernelHeuristicCount,
    orgHasOwnWwwdStance: orgStanceMaterialCount > 0,
    wwmdOpenReviews,
    wwwdOpenReviews,
    wsidFamilyCount: PROFESSION_REGISTRY.families.length,
    wsidActiveProfiles,
    wsidOpenReviews,
  });

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          Decision governance
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          How your AI workforce decides on your behalf — and where you shape it.
          Three disciplines govern every call: platform doctrine (WWMD), your
          business (WWWD), and each role&rsquo;s craft (WSID).
        </p>
      </header>

      <DecisionDisciplineHub cards={disciplineCards} />

      {/* Review & adjust — the findings workspace over the decision ledger */}
      <Link
        href="/wiki/review"
        className="mt-6 block rounded-lg border border-[var(--dpf-border)] p-4 hover:bg-[var(--dpf-surface-2)] transition-colors"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm text-[var(--dpf-text)]">
              Review &amp; adjust
            </p>
            <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
              As decisions accumulate, resolve clashing principles and cover the
              gaps where your AI has no settled answer yet.
            </p>
          </div>
          <span className="text-sm text-[var(--dpf-accent)] shrink-0 ml-4">Open →</span>
        </div>
      </Link>

      {/* Decision Perspectives — profile + voice admin entry point */}
      <div className="mt-3 rounded-lg border border-[var(--dpf-border)] p-4 flex items-center justify-between">
        <div>
          <p className="font-medium text-sm text-[var(--dpf-text)]">
            Decision perspectives
          </p>
          <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
            Manage the profiles behind each discipline, and give any perspective
            a voice.
          </p>
        </div>
        <Link
          href="/wiki/perspectives"
          className="text-sm text-[var(--dpf-accent)] hover:underline shrink-0 ml-4"
        >
          Manage →
        </Link>
      </div>

      {/* Retained kernel material — the drill-in, one level below the hub. */}
      <section id="governing-material" className="mt-10 scroll-mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-3">
          Governing material
        </h2>
        <p className="text-xs text-[var(--dpf-muted)] mb-4">
          The founder kernel and per-org overlay pages that the disciplines above
          are built from. Kernel pages ship with the platform; overlay pages live
          alongside.
        </p>
        <WikiPageList pages={pages} />
      </section>
    </div>
  );
}
