// Work Atlas business layout (BI-B0D8394B, tailoring spec §4): rooms arranged
// the way the business runs, in lanes (channels, zones, providers, beds, bays…)
// across its time axis (service periods, arrival windows, appointment hours…).
// The squares are the same glyphs as the portfolio map, so a state reads the
// same for every business. Rooms that record no placement are shown under
// "Not yet placed", never dropped.
//
// Each lane is a block whose time slots wrap, so the board stacks at phone
// width with no sideways scroll.

import Link from "next/link";
import type { MessageKey } from "@dpf/i18n";

import { AtlasGlyph } from "@/components/ops/workrooms/atlas/AtlasGlyph";
import type { AtlasTranslate } from "@/components/ops/workrooms/atlas/WorkAtlas";
import { Surface } from "@/components/ui/Surface";
import { placeAtlasRooms, type AtlasLayout } from "@/lib/work-management/atlas-layout";
import { atlasHref, compareAtlasRooms, inAtlasScope, matchesAtlasState, type AtlasView } from "@/lib/work-management/atlas-map";
import type { AtlasPicture, AtlasRoom } from "@/lib/work-management/atlas-projection";

const FOCUS = "rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]";

function Cells({ rooms, view, basePath, label, t }: { rooms: readonly AtlasRoom[]; view: AtlasView; basePath: string; label: string; t: AtlasTranslate }) {
  return (
    <ul className="mt-1 flex min-h-4 flex-wrap gap-1" aria-label={label}>
      {[...rooms].sort(compareAtlasRooms).map((room) => {
        const cell = t("atlas.cell", { title: room.title, state: t(`atlas.state.${room.health}` as MessageKey<"workrooms">) });
        return (
          <li key={room.capsuleId} className={matchesAtlasState(room, view) ? undefined : "opacity-25"}>
            <Link href={atlasHref(basePath, view, { room: room.capsuleId })} tabIndex={-1} title={cell} aria-label={cell}
              data-atlas-cell={room.capsuleId}
              className={`flex h-4 w-4 items-center justify-center hover:ring-1 hover:ring-[var(--dpf-text)] ${view.room === room.capsuleId ? "ring-2 ring-[var(--dpf-accent)]" : ""}`}>
              <AtlasGlyph health={room.health} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The rooms in one lane or slot, as rows a keyboard reaches. */
function RoomLinks({ rooms, view, basePath }: { rooms: readonly AtlasRoom[]; view: AtlasView; basePath: string }) {
  if (!rooms.length) return null;
  return (
    <ul className="sr-only">
      {rooms.map((room) => (
        <li key={room.capsuleId}><Link href={atlasHref(basePath, view, { room: room.capsuleId })}>{room.title}</Link></li>
      ))}
    </ul>
  );
}

export function AtlasLaneBoard({ picture, layout, workItems, view, basePath, t }: {
  picture: AtlasPicture; layout: AtlasLayout; workItems: string; view: AtlasView; basePath: string; t: AtlasTranslate;
}) {
  const rooms = picture.rooms.filter((room) => inAtlasScope(room, view));
  const board = placeAtlasRooms(layout, rooms);
  return (
    <Surface rounded="xl" aria-labelledby="live-workrooms-heading" className="min-w-0" data-atlas-layout={layout.template}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="live-workrooms-heading" className="text-base font-semibold text-[var(--dpf-text)]">
          {t("atlas.layout.heading", { lanes: layout.laneLabel.toLowerCase(), slots: layout.slotLabel.toLowerCase() })}
        </h2>
        <span className="text-dpf-caption text-dpf-muted">{t("atlas.mapTotal", { count: picture.total })}</span>
      </div>
      {picture.truncated ? <p className="mt-1 text-dpf-caption text-dpf-muted">{t("atlas.truncated", { count: picture.total })}</p> : null}

      <div className="mt-3 flex flex-col gap-3">
        {board.lanes.map((lane) => (
          <section key={lane.key} data-atlas-lane={lane.key} aria-labelledby={`atlas-lane-${lane.key}`}
            className="min-w-0 rounded-dpf-xl border border-[var(--dpf-border)] p-3">
            <h3 id={`atlas-lane-${lane.key}`} className="text-dpf-body font-semibold text-[var(--dpf-text)]">{lane.label}</h3>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
              {layout.slots.map((slot) => (
                <div key={slot.key} className="min-w-0" data-atlas-slot={slot.key}>
                  <p className="text-dpf-caption text-dpf-muted">{slot.label}</p>
                  <Cells rooms={lane.cells[slot.key] ?? []} view={view} basePath={basePath} label={t("atlas.layout.cellGroup", { lane: lane.label, slot: slot.label })} t={t} />
                  <RoomLinks rooms={lane.cells[slot.key] ?? []} view={view} basePath={basePath} />
                </div>
              ))}
              {lane.unslotted.length ? (
                <div className="min-w-0" data-atlas-slot="any">
                  <p className="text-dpf-caption text-dpf-muted">{t("atlas.layout.anyTime")}</p>
                  <Cells rooms={lane.unslotted} view={view} basePath={basePath} label={t("atlas.layout.cellGroup", { lane: lane.label, slot: t("atlas.layout.anyTime") })} t={t} />
                  <RoomLinks rooms={lane.unslotted} view={view} basePath={basePath} />
                </div>
              ) : null}
            </div>
          </section>
        ))}
        {board.lanes.length === 0 ? <p className="text-dpf-caption text-dpf-muted">{t("atlas.layout.noLanes", { lanes: layout.laneLabel.toLowerCase() })}</p> : null}
      </div>

      {board.unplaced.length ? (
        <section className="mt-4" aria-labelledby="atlas-unplaced-heading" data-atlas-unplaced>
          <h3 id="atlas-unplaced-heading" className="text-dpf-body font-semibold text-[var(--dpf-text)]">
            {t("atlas.layout.unplaced", { count: board.unplaced.length })}
          </h3>
          <p className="text-dpf-caption text-dpf-muted">{t("atlas.layout.unplacedWhy", { items: workItems, lanes: layout.laneLabel.toLowerCase() })}</p>
          <Cells rooms={board.unplaced} view={view} basePath={basePath} label={t("atlas.layout.unplaced", { count: board.unplaced.length })} t={t} />
          <RoomLinks rooms={board.unplaced} view={view} basePath={basePath} />
        </section>
      ) : null}
    </Surface>
  );
}

export function AtlasJustNow({ rows, view, basePath, locale, t }: {
  rows: ReadonlyArray<{ capsuleId: string; title: string; summary: string; recordedAt: string }>;
  view: AtlasView; basePath: string; locale: string; t: AtlasTranslate;
}) {
  if (!rows.length) return null;
  return (
    <Surface rounded="xl" aria-labelledby="atlas-just-now-heading" data-atlas-just-now className="min-w-0">
      <h2 id="atlas-just-now-heading" className="text-base font-semibold text-[var(--dpf-text)]">{t("atlas.justNow.heading")}</h2>
      <ol className="mt-2 flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={`${row.capsuleId}-${row.recordedAt}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-dpf-caption">
            <time dateTime={row.recordedAt} className="text-dpf-muted">
              {new Date(row.recordedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
            </time>
            <span className="min-w-0 break-words text-[var(--dpf-text)]">
              <Link href={atlasHref(basePath, view, { room: row.capsuleId })} className={`font-semibold hover:underline ${FOCUS}`}>{row.title}</Link>
              {t("atlas.justNow.summary", { summary: row.summary })}
            </span>
          </li>
        ))}
      </ol>
    </Surface>
  );
}
