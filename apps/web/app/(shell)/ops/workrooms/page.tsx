import { prisma } from "@dpf/db";
import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { RhythmStrip } from "@/components/ops/workrooms/atlas/RhythmStrip";
import { AtlasInspector } from "@/components/ops/workrooms/atlas/AtlasInspector";
import { WorkAtlas, roomHref } from "@/components/ops/workrooms/atlas/WorkAtlas";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getT } from "@/lib/i18n/t.server";
import { loadAtlasInspector, type AtlasInspectorDb } from "@/lib/work-management/atlas-inspector.server";
import { atlasFlowHref, atlasHolds, atlasShapeMeta } from "@/lib/work-management/atlas-page.server";
import { atlasHref, parseAtlasFilters, parseAtlasGroup, parseAtlasRoom } from "@/lib/work-management/atlas-map";
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
  const group = parseAtlasGroup(params);
  const selected = parseAtlasRoom(params);
  const view = { ...parseAtlasFilters(params), ...(group ? { group } : {}), ...(selected ? { room: selected } : {}) };
  const [picture, held, rhythms, locale, t] = await Promise.all([
    loadAtlasPicture(prisma), loadHeldWorkrooms(prisma), loadStandingRhythms(prisma), getLocaleContext(), getT("workrooms"),
  ]);

  // A3 (BI-94C9AFC1): the selected room opens beside the map. A room that is
  // not on the map (archived, or past the read limit) opens no panel.
  const room = selected ? picture.rooms.find((candidate) => candidate.capsuleId === selected) : undefined;
  const inspectorData = room ? await loadAtlasInspector(prisma as unknown as AtlasInspectorDb, room.capsuleId) : null;
  const holds = atlasHolds(held);
  const inspector = room && inspectorData ? (
    <AtlasInspector room={room} data={inspectorData} hold={holds[room.capsuleId]} roomHref={roomHref(room.capsuleId)}
      flowHref={atlasFlowHref(room.portfolio, room.shape, room.stage)} closeHref={atlasHref("/ops/workrooms", view, { room: null })}
      locale={locale.language} t={t} />
  ) : null;

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
        shapes={atlasShapeMeta(picture.rooms)} holds={holds} locale={locale.language} t={t} inspector={inspector} />
      {/* Work Atlas A4 (BI-D8A6F0F2): standing operations get their own band, so a missed day is as visible as a stuck project. */}
      <MessagesProvider locale={locale.language} messages={{ workrooms: namespaceMessages(locale.language, "workrooms") }}>
        <RhythmStrip rows={rhythms} locale={locale.language} />
      </MessagesProvider>
    </div>
  );
}
