// EP-0AF96937 Phase 3: WWWD business-stance surface.
// Where a business sees and adjusts how it decides ("what would WE do") — the
// org's own recorded stances that ground the coworkers' business calls. Lists
// the org-overlay stance pages and offers the plain-language authoring form.
// Server component; queries Prisma directly.

import Link from "next/link";
import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { BusinessStanceForm } from "@/components/wiki/BusinessStanceForm";
import { HowYouDecideCards, type StanceCard } from "@/components/onboarding/HowYouDecideCards";
import { BUSINESS_STANCE_SLUG_PREFIX } from "@/lib/wiki/business-stance";
import {
  resolveStanceVectors,
  resolveStanceAuthoringExamples,
  STANCE_VECTOR_KEYS,
} from "@/lib/onboarding/archetype-business-context";
import { stanceVectorSlug } from "@/lib/onboarding/seed-org-wwwd-corpus";
import { resolveOrgProfileId } from "@/lib/decision-perspective/material";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your business stance · Coworker Decision Engine",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Active",
  "review-needed": "Review needed",
};

export default async function BusinessStancePage() {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  const organizationId = organization?.id ?? null;

  // The org's own WWWD stances: org-overlay stance/principle pages. (Kernel
  // rows have organizationId = null and are the platform baseline, not the
  // business's own doctrine.)
  const stances = organizationId
    ? await prisma.wikiPage.findMany({
        where: {
          organizationId,
          pageKind: { in: ["stance", "principle"] },
        },
        orderBy: [{ status: "asc" }, { title: "asc" }],
        select: { id: true, slug: true, title: true, status: true, abstract: true },
      })
    : [];

  // "How you decide" cards (BI-D6DC2432): archetype-prefilled stance vectors,
  // shown until the owner confirms them. Confirmed = the vector's primary
  // material sits at the owner-confirmed tier (A / >=0.9).
  let cards: StanceCard[] = [];
  let authoringExamples = resolveStanceAuthoringExamples({ industry: null });
  if (organizationId) {
    const [storefront, profileId] = await Promise.all([
      prisma.storefrontConfig.findFirst({
        select: { archetypeId: true, archetype: { select: { category: true } } },
      }),
      resolveOrgProfileId({ db: prisma, organizationId }),
    ]);
    const defaults = resolveStanceVectors({
      archetypeId: storefront?.archetypeId ?? null,
      industry: storefront?.archetype?.category ?? null,
    });
    authoringExamples = resolveStanceAuthoringExamples({
      industry: storefront?.archetype?.category ?? null,
    });
    const vectorSlugs = STANCE_VECTOR_KEYS.map((key) => stanceVectorSlug(key));
    const [vectorPages, vectorMaterials] = await Promise.all([
      prisma.wikiPage.findMany({
        where: { organizationId, slug: { in: vectorSlugs } },
        select: { slug: true, abstract: true, body: true },
      }),
      profileId
        ? prisma.perspectiveMaterial.findMany({
            where: { materialId: { in: vectorSlugs.map((slug) => `${profileId}:${slug}`) } },
            select: { materialId: true, evidenceGrade: true, confidenceWeight: true },
          })
        : Promise.resolve([]),
    ]);
    const pageBySlug = new Map(vectorPages.map((page) => [page.slug, page]));
    const materialById = new Map(vectorMaterials.map((m) => [m.materialId, m]));

    cards = STANCE_VECTOR_KEYS.map((key) => {
      const slug = stanceVectorSlug(key);
      const page = pageBySlug.get(slug);
      const material = profileId ? materialById.get(`${profileId}:${slug}`) : undefined;
      const stance = page?.abstract?.trim() || defaults[key].stance;
      // The ceiling is stance content, not schema: read it back from the page
      // body when present, else the archetype default.
      const ceilingMatch = page?.body?.match(/up to \$(\d+) per case/i);
      const ceilingUsd = ceilingMatch
        ? Number(ceilingMatch[1])
        : defaults[key].ceilingUsd ?? null;
      return {
        key,
        title: defaults[key].title,
        stance,
        ceilingUsd,
        confirmed:
          material?.evidenceGrade === "A" && (material?.confidenceWeight ?? 0) >= 0.9,
      };
    });
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2 text-sm text-[var(--dpf-muted)]">
        <Link href="/coworker-decisions" className="hover:text-[var(--dpf-text)]">
          Coworker Decision Engine
        </Link>
        <span>/</span>
        <span className="text-[var(--dpf-text)] font-medium">Your business (WWWD)</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          How your business decides
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          When a coworker faces a business call — what to fund, how to handle a
          customer, which way to lean — it grounds the answer in your recorded
          stances. Platform doctrine only advises; your business is the
          authority here. Add or adjust a stance and it shapes how every
          coworker decides on your behalf.
        </p>
      </header>

      <HowYouDecideCards cards={cards} />

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-3">
          Your stances
        </h2>
        {stances.length === 0 ? (
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center">
            <p className="text-sm text-[var(--dpf-text)]">
              You haven&rsquo;t recorded a business stance yet.
            </p>
            <p className="text-xs text-[var(--dpf-muted)] mt-1">
              Until you do, coworkers lean on general platform doctrine for
              business calls and flag the ones they can&rsquo;t ground. Record
              your first stance below.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)]">
            {stances.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/coworker-decisions/${s.slug}`}
                    className="text-sm font-medium text-[var(--dpf-text)] hover:underline min-w-0 flex-1 truncate"
                  >
                    {s.title}
                  </Link>
                  <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] shrink-0">
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  {s.slug.startsWith(`${BUSINESS_STANCE_SLUG_PREFIX}/`) && (
                    <Link
                      href={`/coworker-decisions/edit/${s.slug}`}
                      className="text-xs text-[var(--dpf-accent)] hover:underline shrink-0"
                    >
                      Edit
                    </Link>
                  )}
                </div>
                {s.abstract && (
                  <p className="text-xs text-[var(--dpf-muted)] mt-1 line-clamp-2">
                    {s.abstract}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <BusinessStanceForm examples={authoringExamples} />

      <p className="text-xs text-[var(--dpf-muted)] mt-6">
        Reviewing what your AI has already decided?{" "}
        <Link href="/coworker-decisions/review" className="text-[var(--dpf-accent)] hover:underline">
          Go to Review &amp; adjust
        </Link>
        .
      </p>
    </div>
  );
}
