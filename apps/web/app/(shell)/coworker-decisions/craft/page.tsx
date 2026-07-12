// EP-0AF96937 Phase 4: WSID craft index.
// The professions the platform grounds your coworkers in ("what should I do" —
// the competent-professional answer for each role) and where a business adds
// its own local overrides. Server component; queries Prisma directly.

import Link from "next/link";
import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";
import { CRAFT_OVERRIDE_SLUG_PREFIX } from "@/lib/wiki/craft-override";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Craft (WSID) · Coworker Decision Engine",
};

/** Second path segment of a `craft/<professionKey>/<slug>` overlay slug. */
function professionKeyFromSlug(slug: string): string | null {
  const parts = slug.split("/");
  return parts[0] === CRAFT_OVERRIDE_SLUG_PREFIX && parts.length >= 3
    ? parts[1]
    : null;
}

export default async function CraftIndexPage() {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  const organizationId = organization?.id ?? null;

  // Count the org's overrides per profession in one query.
  const overrideRows = organizationId
    ? await prisma.wikiPage.findMany({
        where: {
          organizationId,
          slug: { startsWith: `${CRAFT_OVERRIDE_SLUG_PREFIX}/` },
        },
        select: { slug: true },
      })
    : [];
  const overridesByProfession = new Map<string, number>();
  for (const row of overrideRows) {
    const key = professionKeyFromSlug(row.slug);
    if (key) overridesByProfession.set(key, (overridesByProfession.get(key) ?? 0) + 1);
  }

  const families = [...PROFESSION_REGISTRY.families].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2 text-sm text-[var(--dpf-muted)]">
        <Link href="/coworker-decisions" className="hover:text-[var(--dpf-text)]">
          Coworker Decision Engine
        </Link>
        <span>/</span>
        <span className="text-[var(--dpf-text)] font-medium">Each role&rsquo;s craft (WSID)</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          Each role&rsquo;s craft
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Every coworker is grounded in what a competent professional in its role
          should do. That baseline ships with the platform — here you can see it
          per role and add your own local practices on top.
        </p>
      </header>

      <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)]">
        {families.map((family) => {
          const overrides = overridesByProfession.get(family.professionKey) ?? 0;
          return (
            <li key={family.professionKey}>
              <Link
                href={`/coworker-decisions/craft/${encodeURIComponent(family.professionKey)}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--dpf-surface-2)]"
              >
                <span className="text-sm font-medium text-[var(--dpf-text)] min-w-0 flex-1 truncate">
                  {family.label}
                </span>
                <span className="text-xs text-[var(--dpf-muted)] shrink-0">
                  {family.roles.length} role{family.roles.length !== 1 ? "s" : ""}
                </span>
                {overrides > 0 && (
                  <span className="rounded border border-[var(--dpf-success)] px-2 py-0.5 text-xs text-[var(--dpf-success)] shrink-0">
                    {overrides} override{overrides !== 1 ? "s" : ""}
                  </span>
                )}
                <span className="text-[var(--dpf-muted)] shrink-0" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
