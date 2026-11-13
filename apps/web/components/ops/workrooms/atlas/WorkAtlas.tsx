// Work Atlas (BI-3791FDD8, design §3.1–3.3): today's question, the five triage
// counts that filter, and the glyph map of every room grouped by portfolio and
// shape. A group expands into paged rows. Filters and the open group live in
// the URL, so other surfaces link in and a refresh keeps the view.
//
// Server-rendered links only: no client state, so the page works without
// JavaScript and every control is a real link a keyboard reaches.
//
// Keyboard and screen-reader path: the counts, the group links and the rows.
// The squares are a pointer shortcut; each shape line is labelled with its
// totals, and every room in it is reachable through that group's rows.

import Link from "next/link";
import type { MessageArgs, MessageKey } from "@dpf/i18n";

import { AtlasGlyph } from "@/components/ops/workrooms/atlas/AtlasGlyph";
import { Surface } from "@/components/ui/Surface";
import type { AtlasHealth } from "@/lib/work-management/atlas-health";
import {
  ATLAS_ROWS_PER_PAGE,
  ATLAS_TRIAGE_STATES,
  ATLAS_UNSHAPED,
  atlasGroupKey,
  atlasHref,
  atlasQuestionAnswer,
  atlasTriageCounts,
  groupAtlas,
  matchesAtlasState,
  type AtlasHold,
  type AtlasShapeMeta,
  type AtlasView,
} from "@/lib/work-management/atlas-map";
import type { AtlasPicture, AtlasRoom } from "@/lib/work-management/atlas-projection";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";

export type AtlasTranslate = (key: MessageKey<"workrooms">, args?: MessageArgs) => string;


type Props = {
  picture: AtlasPicture;
  view: AtlasView;
  basePath: string;
  shapes: Record<string, AtlasShapeMeta>;
  holds: Record<string, AtlasHold>;
  locale: string;
  t: AtlasTranslate;
};

const FOCUS = "rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]";

export function roomHref(capsuleId: string): string {
  return `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: capsuleId })}`;
}

function shortDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function stateLabel(t: AtlasTranslate, state: AtlasHealth): string {
  return t(`atlas.state.${state}` as MessageKey<"workrooms">);
}

function portfolioLabel(t: AtlasTranslate, portfolio: string): string {
  return portfolio === "unplaced" ? t("atlas.unplaced") : portfolioRoleLabel(portfolio);
}

function shapeLabel(t: AtlasTranslate, shapes: Record<string, AtlasShapeMeta>, shape: string): string {
  return shape === ATLAS_UNSHAPED ? t("atlas.unshaped") : shapes[shape]?.title ?? shape;
}

function StageRail({ room, meta, t }: { room: AtlasRoom; meta: AtlasShapeMeta | undefined; t: AtlasTranslate }) {
  if (!meta || meta.stages.length === 0) return null;
  const current = room.stage ? meta.stages.findIndex((stage) => stage.key === room.stage) : -1;
  const currentTitle = current >= 0 ? meta.stages[current]?.title : undefined;
  return (
    <span className="inline-flex items-center gap-1" role="img"
      aria-label={currentTitle ? t("atlas.stageCurrent", { stage: currentTitle }) : t("atlas.stages")}>
      {meta.stages.map((stage, index) => {
        const done = current >= 0 && index < current;
        const here = index === current;
        return (
          <span key={stage.key} aria-hidden title={stage.title} data-stage-state={here ? "current" : done ? "done" : "todo"}
            className="block h-1 w-3 rounded-full"
            style={{
              background: here
                ? (room.health === "stuck" ? "var(--dpf-error)" : room.health === "needs-person" ? "var(--dpf-warning)" : "var(--dpf-accent)")
                : done ? "var(--dpf-muted)" : "transparent",
              border: done || here ? "none" : "1px solid var(--dpf-border)",
            }} />
        );
      })}
    </span>
  );
}

function RoomRow({ room, meta, hold, locale, t }: {
  room: AtlasRoom; meta: AtlasShapeMeta | undefined; hold: AtlasHold | undefined; locale: string; t: AtlasTranslate;
}) {
  return (
    <li data-atlas-row={room.capsuleId}
      className="flex flex-col gap-1 py-2 sm:grid sm:grid-cols-[minmax(0,1.6fr)_auto_minmax(0,1.4fr)] sm:items-center sm:gap-4">
      <span className="flex min-w-0 items-center gap-2">
        <AtlasGlyph health={room.health} />
        <span className="sr-only">{stateLabel(t, room.health)}: </span>
        <Link href={roomHref(room.capsuleId)} className={`min-w-0 break-words text-dpf-body font-medium text-[var(--dpf-text)] hover:underline ${FOCUS}`}>
          {room.title}
        </Link>
      </span>
      <StageRail room={room} meta={meta} t={t} />
      <span className="min-w-0 text-dpf-caption text-dpf-muted">
        {t("atlas.rowMeta", {
          what: hold
            ? hold.since ? t("atlas.heldSince", { date: shortDate(hold.since, locale), reason: hold.reason }) : t("atlas.held", { reason: hold.reason })
            : t(room.label),
          who: room.owner ? t("atlas.owner", { name: room.owner }) : t("atlas.ownerNone"),
        })}
      </span>
    </li>
  );
}

export function WorkAtlas({ picture, view, basePath, shapes, holds, locale, t }: Props) {
  const counts = atlasTriageCounts(picture.rooms, view);
  const answer = atlasQuestionAnswer(picture.rooms, view);
  const groups = groupAtlas(picture.rooms, view);
  const filtered = Boolean(view.portfolio || view.shape || view.state);
  const filterNames = [
    view.portfolio ? portfolioLabel(t, view.portfolio) : null,
    view.shape ? shapeLabel(t, shapes, view.shape) : null,
    view.state ? stateLabel(t, view.state) : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="mt-6 flex min-w-0 flex-col gap-4" data-work-atlas>
      <p className="max-w-3xl text-dpf-caption text-dpf-muted">{t("atlas.intro")}</p>

      {/* 3.1 Today's question */}
      <Surface rounded="xl" data-atlas-question>
        <p className="text-dpf-caption font-semibold uppercase tracking-wide text-dpf-muted">{t("atlas.questionLabel")}</p>
        <p className="mt-1 text-dpf-body text-[var(--dpf-text)]">
          <span className="font-semibold">{t("atlas.question")}</span>{" "}
          {answer.waiting === 0 ? t("atlas.answerNone") : t("atlas.answerCount", { count: answer.waiting })}{" "}
          {answer.oldest ? (
            <Link href={roomHref(answer.oldest.capsuleId)} className={`text-[var(--dpf-accent)] hover:underline ${FOCUS}`}>
              {t("atlas.answerOldest", { title: answer.oldest.title, date: shortDate(answer.oldest.lastSignalAt, locale) })}
            </Link>
          ) : null}
        </p>
      </Surface>

      {/* 3.2 Triage counts that double as filters */}
      <nav aria-label={t("atlas.countsLabel")}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {ATLAS_TRIAGE_STATES.map((state) => {
            const selected = view.state === state;
            return (
              <Surface as="li" key={state} padding="none" rounded="xl"
                className={`min-w-0 ${selected ? "!border-[var(--dpf-accent)] !bg-[var(--dpf-accent-soft)]" : "hover:!border-[var(--dpf-border-strong)]"}`}>
                <Link href={atlasHref(basePath, view, { state: selected ? null : state, group: null })}
                  aria-current={selected ? "true" : undefined} data-atlas-count={state}
                  className={`flex h-full flex-col gap-1 rounded-dpf-xl p-3 ${FOCUS}`}>
                  <span className="flex items-center gap-2 text-xl font-bold text-[var(--dpf-text)]">
                    <AtlasGlyph health={state} />
                    {counts[state]}
                  </span>
                  <span className="text-dpf-caption text-dpf-muted">{stateLabel(t, state)}</span>
                </Link>
              </Surface>
            );
          })}
        </ul>
      </nav>
      {filtered ? (
        <p className="text-dpf-caption text-dpf-muted">
          {t("atlas.filtered", { filter: filterNames })}{" "}
          <Link href={basePath} className={`text-[var(--dpf-accent)] hover:underline ${FOCUS}`}>{t("atlas.clearAll")}</Link>
        </p>
      ) : null}

      {/* 3.3 Glyph map by portfolio, then shape */}
      <Surface rounded="xl" aria-labelledby="live-workrooms-heading" className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="live-workrooms-heading" className="text-base font-semibold text-[var(--dpf-text)]">{t("atlas.mapHeading")}</h2>
          <span className="text-dpf-caption text-dpf-muted">{t("atlas.mapTotal", { count: picture.total })}</span>
        </div>
        {picture.truncated ? <p className="mt-1 text-dpf-caption text-dpf-muted">{t("atlas.truncated", { count: picture.total })}</p> : null}
        {groups.length === 0 ? <p className="mt-3 text-dpf-body text-dpf-muted">{t("atlas.empty")}</p> : null}
        <div className="mt-3 flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.portfolio} aria-labelledby={`atlas-portfolio-${group.portfolio}`} data-atlas-portfolio={group.portfolio}>
              <h3 id={`atlas-portfolio-${group.portfolio}`} className="flex flex-wrap items-baseline gap-x-2 text-dpf-body font-semibold text-[var(--dpf-text)]">
                <Link href={atlasHref(basePath, view, { portfolio: view.portfolio === group.portfolio ? null : group.portfolio, group: null })}
                  className={`hover:underline ${FOCUS}`}>
                  {portfolioLabel(t, group.portfolio)}
                </Link>
                <span className="text-dpf-caption font-normal text-dpf-muted">
                  {t("atlas.portfolioSummary", { total: group.total, need: group.needPerson, stuck: group.stuck })}
                </span>
              </h3>
              <div className="mt-2 flex flex-col gap-3">
                {group.shapes.map((shape) => {
                  const key = atlasGroupKey(group.portfolio, shape.shape);
                  const open = view.group === key;
                  const name = shapeLabel(t, shapes, shape.shape);
                  const visible = shape.rooms.filter((room) => matchesAtlasState(room, view));
                  const hidden = Math.max(0, visible.length - ATLAS_ROWS_PER_PAGE);
                  return (
                    <div key={shape.shape} className="min-w-0" data-atlas-shape={shape.shape}>
                      <Link href={atlasHref(basePath, view, { group: open ? null : key })} aria-expanded={open}
                        title={open ? t("atlas.hideRows", { shape: name }) : t("atlas.showRows", { shape: name })}
                        className={`inline-flex items-center gap-1 text-dpf-caption text-dpf-muted hover:text-[var(--dpf-text)] hover:underline ${FOCUS}`}>
                        <span aria-hidden className={`inline-block h-1.5 w-1.5 border-b border-e border-current ${open ? "rotate-45" : "-rotate-45"}`} />
                        {t("atlas.shapeSummary", { shape: name, count: shape.rooms.length })}
                      </Link>
                      <ul className="mt-1 flex flex-wrap gap-1" aria-label={t("atlas.shapeSummary", { shape: name, count: shape.rooms.length })}>
                        {shape.rooms.map((room) => {
                          const dim = !matchesAtlasState(room, view);
                          const label = t("atlas.cell", { title: room.title, state: stateLabel(t, room.health) });
                          return (
                            <li key={room.capsuleId} className={dim ? "opacity-25" : undefined}>
                              <Link href={roomHref(room.capsuleId)} tabIndex={-1} title={label} aria-label={label}
                                data-atlas-cell={room.capsuleId} className="flex h-4 w-4 items-center justify-center hover:ring-1 hover:ring-[var(--dpf-text)]">
                                <AtlasGlyph health={room.health} />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                      {open ? (
                        <div className="mt-2 rounded-dpf-xl border border-[var(--dpf-border)] px-3">
                          <ul className="divide-y divide-[var(--dpf-border)]">
                            {visible.slice(0, ATLAS_ROWS_PER_PAGE).map((room) => (
                              <RoomRow key={room.capsuleId} room={room} meta={shapes[shape.shape]} hold={holds[room.capsuleId]} locale={locale} t={t} />
                            ))}
                          </ul>
                          {hidden ? (
                            <p className="border-t border-[var(--dpf-border)] py-2 text-dpf-caption text-dpf-muted">
                              {t("atlas.more", { count: hidden })}
                            </p>
                          ) : null}
                          {visible.length === 0 ? <p className="py-2 text-dpf-caption text-dpf-muted">{t("atlas.empty")}</p> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </Surface>
    </div>
  );
}
