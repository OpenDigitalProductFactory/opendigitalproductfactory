import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { WorkroomActivitySection } from "@/components/ops/workrooms/WorkroomActivitySection";
import { SectionNav } from "@/components/shell/SectionNav";
import { Surface } from "@/components/ui/Surface";
import { loadAreaTeam } from "@/lib/areas/area-team.server";
import { auth } from "@/lib/auth";
import { getAreaSetupEntries } from "@/lib/navigation/portal-navigation-model";
import { AREA_SECTIONS, areaHref } from "@/lib/navigation/portal-shell-sections";
import { can, getGrantedCapabilities } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type AreaView = "work" | "team" | "setup";

type Props = {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ view?: string }>;
};

const VIEW_LEAD: Record<AreaView, string> = {
  work: "The Workrooms placed in this area.",
  team: "The people and AI coworkers who work here, and what each may do.",
  setup: "The settings this area's work reads. Each opens its one home.",
};

// EP-2FB6C0CC (spec 2026-08-14-portfolio-shaped-information-architecture-design.md
// §9.3): a portfolio section of the rail is a workroom-shaped area. Its home shows
// the work going on in it, who works there, and the setup that work reads. Every
// view is a projection of an existing home — the workroom inventory, the authority
// bindings and participants, the nav model's settings records — never a copy.
export default async function AreaPage({ params, searchParams }: Props) {
  const { key } = await params;
  const section = AREA_SECTIONS.find((candidate) => candidate.key === key);
  if (!section) notFound();

  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser };

  const { view: requested } = await searchParams;
  const view: AreaView = requested === "team" || requested === "setup" ? requested : "work";

  const granted = new Set<string>(getGrantedCapabilities(user));
  const setupEntries = getAreaSetupEntries(section.key).filter(
    (entry) => entry.capabilityKey === null || granted.has(entry.capabilityKey),
  );
  const canSeeWork = can(user, "view_operations");
  const team = view === "team" ? await loadAreaTeam(section.key, section.portfolioRole) : [];
  const work =
    view === "work" && canSeeWork
      ? await WorkroomActivitySection({ portfolioRole: section.portfolioRole, scopeLabel: section.label })
      : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{section.label}</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-[var(--dpf-muted)]">{section.description}</p>
      </div>
      <SectionNav
        config={{
          variant: "flat",
          as: "nav",
          dataComponent: "area-nav",
          tabs: (["work", "team", "setup"] as const).map((candidate) => ({
            key: candidate,
            label: candidate === "work" ? "Work" : candidate === "team" ? "Team" : "Setup",
            href: areaHref(section.key, candidate),
            active: view === candidate,
          })),
        }}
      />

      {view === "work" &&
        (canSeeWork ? (
          work
        ) : (
          <Surface data-dpf-lead className="my-6" rounded="xl">
            <p className="text-sm text-[var(--dpf-text)]">Your role does not include viewing Workrooms.</p>
          </Surface>
        ))}

      {view === "team" && (
        <>
          <Surface data-dpf-lead className="my-6" rounded="xl">
            <p className="text-sm font-medium text-[var(--dpf-text)]">{VIEW_LEAD.team}</p>
          </Surface>
          {team.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No one is assigned to this area yet.</p>
          ) : (
            <ul className="grid gap-3" aria-label={`${section.label} team`}>
              {team.map((member) => (
                <li key={member.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--dpf-text)]">
                    {member.href ? (
                      <Link href={member.href} className="hover:underline">
                        {member.name}
                      </Link>
                    ) : (
                      member.name
                    )}
                    <span className="ml-2 text-xs font-normal text-[var(--dpf-muted)]">
                      {member.kind === "coworker" ? "AI coworker" : member.kind === "person" ? "Person" : "Role"}
                    </span>
                  </p>
                  <ul className="mt-1 text-xs text-[var(--dpf-muted)]">
                    {member.does.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {view === "setup" && (
        <>
          <Surface data-dpf-lead className="my-6" rounded="xl">
            <p className="text-sm font-medium text-[var(--dpf-text)]">{VIEW_LEAD.setup}</p>
          </Surface>
          {setupEntries.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">Your role has no settings to change in this area.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label={`${section.label} setup`}>
              {setupEntries.map((entry) => (
                <li key={entry.key}>
                  <Link
                    href={entry.path}
                    className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
                  >
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
