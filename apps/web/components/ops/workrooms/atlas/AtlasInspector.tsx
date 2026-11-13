// Work Atlas room inspector (BI-94C9AFC1, design §3.6): the selected room as a
// checklist. Stages come from the room's flow map, the same model the room page
// draws, so the two cannot disagree. Each stage state has its own mark as well as
// its colour. The panel adds the live line, the person or cause the room is
// waiting on, the accountable person, and time at this step against usual.

import Link from "next/link";
import type { MessageKey } from "@dpf/i18n";

import { AtlasGlyph } from "@/components/ops/workrooms/atlas/AtlasGlyph";
import type { AtlasTranslate } from "@/components/ops/workrooms/atlas/WorkAtlas";
import { Surface } from "@/components/ui/Surface";
import { formatDuration } from "@/lib/datetime";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";
import type { AtlasInspectorData } from "@/lib/work-management/atlas-inspector.server";
import type { AtlasHold } from "@/lib/work-management/atlas-map";
import type { AtlasRoom } from "@/lib/work-management/atlas-projection";
import { describeHoldCause } from "@/lib/work-management/workroom-hold-cause";
import type { FlowMapStage, FlowMapStageState } from "@/lib/work-management/workroom-flow-map";

const FOCUS = "rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]";

// Done is a filled check, current is a thick ring, waiting on a person is a
// filled bang, held is a filled bar, and still to do is a dashed ring.
const MARK: Record<FlowMapStageState, { text: string; colour: string; dashed: boolean; filled: boolean }> = {
  done: { text: "✓", colour: "var(--dpf-muted)", dashed: false, filled: true },
  working: { text: "", colour: "var(--dpf-accent)", dashed: false, filled: false },
  "awaiting-person": { text: "!", colour: "var(--dpf-warning)", dashed: false, filled: true },
  blocked: { text: "–", colour: "var(--dpf-error)", dashed: false, filled: true },
  ahead: { text: "", colour: "var(--dpf-border-strong)", dashed: true, filled: false },
};

function StageMark({ state }: { state: FlowMapStageState }) {
  const mark = MARK[state];
  return (
    <span aria-hidden data-stage-mark={state}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-dpf-caption font-bold leading-none"
      style={{
        border: `${state === "working" ? 2.5 : 1.5}px ${mark.dashed ? "dashed" : "solid"} ${mark.colour}`,
        background: mark.filled ? mark.colour : "transparent",
        color: "var(--dpf-surface-1)",
      }}>
      {mark.text}
    </span>
  );
}

/** The step the room is on: the first one that is neither done nor still ahead. */
export function inspectorCurrentStage(stages: readonly FlowMapStage[]): FlowMapStage | null {
  return stages.find((stage) => stage.state !== "done" && stage.state !== "ahead") ?? null;
}

type Props = {
  room: AtlasRoom;
  data: AtlasInspectorData;
  hold: AtlasHold | undefined;
  roomHref: string;
  flowHref: string | null;
  closeHref: string;
  locale: string;
  t: AtlasTranslate;
};

export function AtlasInspector({ room, data, hold, roomHref, flowHref, closeHref, locale, t }: Props) {
  const stages = data.flow?.stages ?? [];
  const current = inspectorCurrentStage(stages);
  const stuckCause = hold?.reason ?? (current?.holdCause ? describeHoldCause(current.holdCause) : null);
  const shapeTitle = data.flow?.title;
  return (
    <Surface as="aside" rounded="xl" aria-labelledby="atlas-inspector-heading" data-atlas-inspector={room.capsuleId} className="min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-dpf-caption text-dpf-muted">
            {shapeTitle ? t("atlas.inspector.idShape", { id: room.capsuleId, shape: shapeTitle }) : room.capsuleId}
          </p>
          <h2 id="atlas-inspector-heading" className="mt-0.5 break-words text-base font-semibold text-[var(--dpf-text)]">{room.title}</h2>
          <p className="mt-1 flex items-center gap-2 text-dpf-caption text-dpf-muted">
            <AtlasGlyph health={room.health} />
            {t(`atlas.state.${room.health}` as MessageKey<"workrooms">)}
          </p>
        </div>
        <Link href={closeHref} className={`shrink-0 text-dpf-caption text-[var(--dpf-accent)] hover:underline ${FOCUS}`}>{t("atlas.inspector.close")}</Link>
      </div>

      {stages.length ? (
        <ol aria-label={t("atlas.stages")} className="mt-3 flex flex-col gap-2 rounded-dpf-xl border border-[var(--dpf-border)] p-3">
          {stages.map((stage) => (
            <li key={stage.key} data-inspector-stage={stage.key} data-stage-state={stage.state}
              aria-current={stage === current ? "step" : undefined}
              className={`flex items-center gap-2 text-dpf-body ${stage.state === "ahead" ? "text-dpf-muted" : "text-[var(--dpf-text)]"} ${stage === current ? "font-semibold" : ""}`}>
              <StageMark state={stage.state} />
              <span className="min-w-0 break-words">{stage.title}</span>
              <span className="sr-only">{t(`atlas.inspector.stage.${stage.state}` as MessageKey<"workrooms">)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-dpf-caption text-dpf-muted">{t("atlas.inspector.noShape")}</p>
      )}

      <p className="mt-3 text-dpf-caption text-dpf-muted" data-inspector-live>
        {data.live
          ? t("atlas.inspector.live", {
            summary: data.live.summary,
            date: new Date(data.live.recordedAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }),
          })
          : t("atlas.inspector.noLive")}
      </p>

      {room.health === "needs-person" ? (
        <p className="mt-3 rounded-dpf-xl border border-[var(--dpf-warning)] p-3 text-dpf-body text-[var(--dpf-text)]" data-inspector-callout="needs-person">
          {t("atlas.inspector.needsPerson", { who: room.owner ?? t("atlas.ownerNone"), what: t(room.label) })}
        </p>
      ) : null}
      {room.health === "stuck" ? (
        <div className="mt-3 rounded-dpf-xl border border-[var(--dpf-error)] p-3 text-dpf-body text-[var(--dpf-text)]" data-inspector-callout="stuck">
          <p>{stuckCause ? t("atlas.inspector.stuck", { cause: stuckCause }) : t("atlas.inspector.stuckUnknown")}</p>
          {hold?.recovery ? <p className="mt-1 text-dpf-caption text-dpf-muted">{t("atlas.inspector.recovery", { condition: hold.recovery })}</p> : null}
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-dpf-caption">
        <dt className="text-dpf-muted">{t("atlas.inspector.accountable")}</dt>
        <dd className="text-[var(--dpf-text)]">{room.owner ?? t("atlas.ownerNone")}</dd>
        <dt className="text-dpf-muted">{t("atlas.inspector.portfolio")}</dt>
        <dd className="text-[var(--dpf-text)]">{room.portfolio === "unplaced" ? t("atlas.unplaced") : portfolioRoleLabel(room.portfolio)}</dd>
        {current?.room ? (
          <>
            <dt className="text-dpf-muted">{t("atlas.inspector.atStep")}</dt>
            <dd className="text-[var(--dpf-text)]">
              {current.typical
                ? t("atlas.inspector.atStepUsual", { duration: formatDuration(current.room.dwellMs), usual: formatDuration(current.typical.dwellMs) })
                : formatDuration(current.room.dwellMs)}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={roomHref} data-inspector-open
          className={`inline-flex items-center rounded-dpf-md border border-[var(--dpf-accent)] px-3 py-1.5 text-dpf-caption font-semibold text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent-soft)] ${FOCUS}`}>
          {t("atlas.inspector.openRoom")}
        </Link>
        {flowHref ? (
          <Link href={flowHref} data-inspector-flow
            className={`inline-flex items-center rounded-dpf-md border border-[var(--dpf-border)] px-3 py-1.5 text-dpf-caption font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-border-strong)] ${FOCUS}`}>
            {t("atlas.inspector.showFlow")}
          </Link>
        ) : null}
      </div>
    </Surface>
  );
}
