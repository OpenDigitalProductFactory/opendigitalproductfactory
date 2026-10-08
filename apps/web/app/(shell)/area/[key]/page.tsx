import Link from "next/link";
import { namespaceMessages } from "@dpf/i18n";
import { notFound, redirect } from "next/navigation";

import { PortfolioFlowTiles, ShapeFlowDrillIn } from "@/components/ops/workrooms/AreaFlowPanel";
import { WorkroomActivitySection } from "@/components/ops/workrooms/WorkroomActivitySection";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { SectionNav } from "@/components/shell/SectionNav";
import { Surface } from "@/components/ui/Surface";
import { loadAreaTeam } from "@/lib/areas/area-team.server";
import { auth } from "@/lib/auth";
import { getAreaSetupEntries } from "@/lib/navigation/portal-navigation-model";
import { AREA_SECTIONS, areaHref } from "@/lib/navigation/portal-shell-sections";
import { getT } from "@/lib/i18n/t.server";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { loadPortfolioFlowView, loadShapeFlowView } from "@/lib/work-management/area-flow.server";
import { can, getGrantedCapabilities } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type AreaView = "work" | "team" | "setup";

type Props = {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ view?: string; shape?: string; version?: string; stage?: string }>;
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

  const { view: requested, shape, version, stage } = await searchParams;
  const view: AreaView = requested === "team" || requested === "setup" ? requested : "work";

  const t = await getT("shell");
  const tFlow = await getT("workrooms");
  const locale = await getLocaleContext();
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
  // EP-B70E718D F4/F5: how this area's work flows, and one shape drawn across its rooms.
  // A failed read hides the panel; the room list below still renders.
  const workHref = `/area/${section.key}?view=work`;
  const portfolioFlow =
    view === "work" && canSeeWork && section.portfolioRole && !shape
      ? await loadPortfolioFlowView().then((flows) => flows.find((flow) => flow.key === section.portfolioRole) ?? null).catch(() => null)
      : null;
  const shapeFlow =
    view === "work" && canSeeWork && shape
      ? await loadShapeFlowView({ shapeKey: shape, version, portfolioRole: section.portfolioRole, stageKey: stage }).catch(() => null)
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
          <>
            {shapeFlow ? (
              <div className="my-6">
                <MessagesProvider locale={locale.language} messages={{ workrooms: namespaceMessages(locale.language, "workrooms") }}>
                  <ShapeFlowDrillIn view={shapeFlow} backHref={workHref} baseHref={workHref} stageKey={stage ?? null} t={tFlow} />
                </MessagesProvider>
              </div>
            ) : portfolioFlow ? (
              <div className="my-6">
                <PortfolioFlowTiles flow={portfolioFlow} areaHref={workHref} t={tFlow} />
              </div>
            ) : null}
            {work}
          </>
        ) : (
          <Surface data-dpf-lead className="my-6" rounded="xl">
            <p className="text-sm text-[var(--dpf-text)]">{t("area.workDenied")}</p>
          </Surface>
        ))}

      {view === "team" && (
        <>
          <Surface data-dpf-lead className="my-6" rounded="xl">
            <p className="text-sm font-medium text-[var(--dpf-text)]">{VIEW_LEAD.team}</p>
          </Surface>
          {team.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">{t("area.teamEmpty")}</p>
          ) : (
            <ul className="grid gap-3" aria-label={`${section.label} team`}>
              {team.map((member) => (
                <Surface as="li" key={member.id} rounded="lg" padding="md">
                  <p className="text-sm font-semibold text-[var(--dpf-text)]">
                    {member.href ? (
                      <Link href={member.href} className="hover:underline">
                        {member.name}
                      </Link>
                    ) : (
                      member.name
                    )}
                    <span className="ms-2 text-xs font-normal text-[var(--dpf-muted)]">
                      {member.kind === "coworker" ? "AI coworker" : member.kind === "person" ? "Person" : "Role"}
                    </span>
                  </p>
                  <ul className="mt-1 text-xs text-[var(--dpf-muted)]">
                    {member.does.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Surface>
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
            <p className="text-sm text-[var(--dpf-muted)]">{t("area.setupEmpty")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label={`${section.label} setup`}>
              {setupEntries.map((entry) => (
                <Surface as="li" key={entry.key} rounded="lg" padding="md">
                  <Link href={entry.path} className="block text-sm font-medium text-[var(--dpf-text)] hover:underline">
                    {entry.label}
                  </Link>
                </Surface>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
