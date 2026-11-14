import { prisma } from "@dpf/db";
import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { RhythmStrip } from "@/components/ops/workrooms/atlas/RhythmStrip";
import { WorkAtlas } from "@/components/ops/workrooms/atlas/WorkAtlas";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getT } from "@/lib/i18n/t.server";
import { atlasHolds, atlasShapeMeta } from "@/lib/work-management/atlas-page.server";
import { parseAtlasFilters, parseAtlasGroup } from "@/lib/work-management/atlas-map";
import { loadAtlasPicture } from "@/lib/work-management/atlas-projection.server";
import { loadHeldWorkrooms } from "@/lib/work-management/held-workrooms";
import { loadStandingRhythms } from "@/lib/work-management/standing-run-history.server";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Work in progress leads with the Work Atlas (BI-3791FDD8): today's question,
 * the triage counts and every open room in one picture. It replaces the lead
 * band, the operator groups, the room inventory, the held-rooms section and
 * the activity tree (design §6); held rooms are the "Stuck or held" filter,
 * and their recorded cause shows on their rows.
 */
export default async function WorkroomsPage({ searchParams }: Props = {}) {
  const params = (await searchParams) ?? {};
  const view = { ...parseAtlasFilters(params), ...(parseAtlasGroup(params) ? { group: parseAtlasGroup(params) } : {}) };
  const [picture, held, rhythms, locale, t] = await Promise.all([
    loadAtlasPicture(prisma), loadHeldWorkrooms(prisma), loadStandingRhythms(prisma), getLocaleContext(), getT("workrooms"),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Work in progress</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-[var(--dpf-muted)]">
          Progress, accountability and next steps.
        </p>
      </div>
      <OpsTabNav />
      <WorkAtlas picture={picture} view={view} basePath="/ops/workrooms"
        shapes={atlasShapeMeta(picture.rooms)} holds={atlasHolds(held)} locale={locale.language} t={t} />
      {/* Work Atlas A4 (BI-D8A6F0F2): standing operations get their own band, so a missed day is as visible as a stuck project. */}
      <MessagesProvider locale={locale.language} messages={{ workrooms: namespaceMessages(locale.language, "workrooms") }}>
        <RhythmStrip rows={rhythms} locale={locale.language} />
      </MessagesProvider>
    </div>
  );
}
