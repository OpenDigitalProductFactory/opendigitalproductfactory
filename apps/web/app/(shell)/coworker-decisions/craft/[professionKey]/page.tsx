// EP-0AF96937 Phase 4: WSID per-profession detail — see the role's craft and
// add your own local overrides. Server component; queries Prisma directly.

import Link from "next/link";
import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";
import { CraftOverrideForm } from "@/components/wiki/CraftOverrideForm";
import { CritiqueCaptureForm } from "@/components/wiki/CritiqueCaptureForm";
import { CRAFT_OVERRIDE_SLUG_PREFIX } from "@/lib/wiki/craft-override";

// The UX critique corpus (BI-3880DA1D) is ux-design's craft, so its capture
// door lives on this one profession's page rather than every profession's.
const CRITIQUE_CORPUS_PROFESSION = "ux-design";

export const dynamic = "force-dynamic";

type Params = Promise<{ professionKey: string }>;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Active",
  "review-needed": "Review needed",
};

export async function generateMetadata({ params }: { params: Params }) {
  const { professionKey } = await params;
  const family = PROFESSION_REGISTRY.families.find(
    (f) => f.professionKey === professionKey,
  );
  return { title: `${family?.label ?? "Craft"} · Coworker Decision Engine` };
}

export default async function CraftProfessionPage({ params }: { params: Params }) {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const { professionKey } = await params;
  const family = PROFESSION_REGISTRY.families.find(
    (f) => f.professionKey === professionKey,
  );
  if (!family) notFound();

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  const organizationId = organization?.id ?? null;

  const overrides = organizationId
    ? await prisma.wikiPage.findMany({
        where: {
          organizationId,
          slug: { startsWith: `${CRAFT_OVERRIDE_SLUG_PREFIX}/${professionKey}/` },
        },
        orderBy: [{ status: "asc" }, { title: "asc" }],
        select: { id: true, slug: true, title: true, status: true, abstract: true },
      })
    : [];

  const profileId = `wsid-${professionKey}`;
  const primaryRole = family.roles[0] ?? null;

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2 text-sm text-[var(--dpf-muted)]">
        <Link href="/coworker-decisions" className="hover:text-[var(--dpf-text)]">
          Coworker Decision Engine
        </Link>
        <span>/</span>
        <Link href="/coworker-decisions/craft" className="hover:text-[var(--dpf-text)]">
          Craft
        </Link>
        <span>/</span>
        <span className="text-[var(--dpf-text)] font-medium">{family.label}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          {family.label}
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Grounds {family.roles.length} coworker role
          {family.roles.length !== 1 ? "s" : ""} in the competent-professional
          answer for this craft. The platform ships the baseline; your overrides
          below apply on top, for your org only.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link
            href={`/coworker-decisions/perspectives/${encodeURIComponent(profileId)}/voice`}
            className="text-[var(--dpf-accent)] hover:underline"
          >
            See how this profile works →
          </Link>
          {primaryRole && (
            <Link
              href={`/platform/ai/agent/${encodeURIComponent(primaryRole)}`}
              className="text-[var(--dpf-accent)] hover:underline"
            >
              Coworker record →
            </Link>
          )}
        </div>
      </header>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-3">
          Your overrides
        </h2>
        {overrides.length === 0 ? (
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center">
            <p className="text-sm text-[var(--dpf-text)]">
              No local overrides for this role yet.
            </p>
            <p className="text-xs text-[var(--dpf-muted)] mt-1">
              Coworkers in this role use the platform baseline. Add a practice
              below to tailor it to how your business works.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)]">
            {overrides.map((o) => (
              <li key={o.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/coworker-decisions/${o.slug}`}
                    className="text-sm font-medium text-[var(--dpf-text)] hover:underline min-w-0 flex-1 truncate"
                  >
                    {o.title}
                  </Link>
                  <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] shrink-0">
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                  <Link
                    href={`/coworker-decisions/edit/${o.slug}`}
                    className="text-xs text-[var(--dpf-accent)] hover:underline shrink-0"
                  >
                    Edit
                  </Link>
                </div>
                {o.abstract && (
                  <p className="text-xs text-[var(--dpf-muted)] mt-1 line-clamp-2">
                    {o.abstract}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {professionKey === CRITIQUE_CORPUS_PROFESSION && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--dpf-muted)] mb-3">
            UX critique corpus
          </h2>
          <CritiqueCaptureForm />
        </section>
      )}

      <CraftOverrideForm professionKey={professionKey} professionLabel={family.label} />
    </div>
  );
}
