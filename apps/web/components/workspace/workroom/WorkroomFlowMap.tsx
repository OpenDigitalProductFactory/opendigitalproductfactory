"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { TRIGGER_GLYPH } from "@/lib/work-management/shape-signature";
import {
  formatDuration,
  type FlowMapStage,
  type FlowMapStageState,
  type WorkroomFlowMapModel,
} from "@/lib/work-management/workroom-flow-map";

// Layout (spec 2026-10-02 §4): three lanes by who does the step, top to bottom
// Outside → People → AI coworkers; steps left to right; a band underneath
// carries this room's time on each step against the shape's typical time.
const LANES = [
  { key: "outside", label: "Outside" },
  { key: "people", label: "People" },
  { key: "ai", label: "AI coworkers" },
] as const;
const LANE_H = 64;
const TOP = 8;
const LABEL_W = 92;
const COL_W = 200;
const BOX_W = 132;
const BOX_H = 40;
const TIMING_H = 52;

const STATE_LABEL: Record<FlowMapStageState, string> = {
  done: "Done",
  working: "Being worked",
  "awaiting-person": "Waiting on a person",
  blocked: "Blocked",
  ahead: "Not reached",
};

// State is carried by form as well as colour: border weight, dash and a glyph.
const STATE_STYLE: Record<FlowMapStageState, { stroke: string; width: number; dash?: string; glyph: string }> = {
  done: { stroke: "var(--dpf-success)", width: 1.5, glyph: "✓" },
  working: { stroke: "var(--dpf-accent)", width: 3, glyph: "▶" },
  "awaiting-person": { stroke: "var(--dpf-warning)", width: 2.5, dash: "5 3", glyph: "◷" },
  blocked: { stroke: "var(--dpf-error)", width: 3, glyph: "!" },
  ahead: { stroke: "var(--dpf-border-strong)", width: 1, dash: "2 3", glyph: "" },
};

const laneY = (lane: FlowMapStage["lane"]) => TOP + (lane === "AI" ? 2 : 1) * LANE_H;
const colX = (index: number) => LABEL_W + 56 + index * COL_W;

function causeLabel(cause: string | null): string | null {
  if (!cause) return null;
  return cause.replaceAll("_", " ");
}

function timingLines(stage: FlowMapStage): { text: string; tone: "text" | "muted" | "warning" }[] {
  const lines: { text: string; tone: "text" | "muted" | "warning" }[] = [];
  if (stage.queue) {
    lines.push({
      text: stage.queue.wip === 0 ? "no rooms here" : `${stage.queue.wip} here · ${stage.queue.depth} waiting`,
      tone: stage.queue.depth > 0 && stage.queue.depth === stage.queue.wip ? "warning" : "text",
    });
  }
  if (stage.room) {
    lines.push({
      text: `${stage.room.open ? "here for" : "took"} ${formatDuration(stage.room.dwellMs)}`,
      tone: stage.slow ? "warning" : "text",
    });
  }
  lines.push(
    stage.typical
      ? { text: `typical ${formatDuration(stage.typical.dwellMs)} · ${stage.typical.exits} runs`, tone: "muted" }
      : { text: "not enough history yet", tone: "muted" },
  );
  return lines;
}

/** The room's work shape as a picture, with this room's time on each step. */
export function WorkroomFlowMap({
  model,
  selectParam = "processStep",
  stageHrefBase,
}: {
  model: WorkroomFlowMapModel;
  /** URL parameter a chosen step is written to: the room's inspection (default) or the shape view's room list. */
  selectParam?: string;
  /** When set, choosing a step navigates to `${stageHrefBase}&stage=<key>` instead (the home's hero → the area drill-in). */
  stageHrefBase?: string;
}) {
  const titleId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const selected = new URLSearchParams(params).get(selectParam);

  function select(stageKey: string) {
    if (stageHrefBase) {
      router.push(`${stageHrefBase}&stage=${encodeURIComponent(stageKey)}`);
      return;
    }
    const search = new URLSearchParams(params);
    search.set(selectParam, stageKey);
    if (selectParam === "processStep") search.set("processLayout", "map");
    router.replace(`${pathname}?${search}${window.location.hash}`, { scroll: false });
  }

  if (model.graphFlow) {
    return (
      <section aria-labelledby={titleId} className="space-y-2 text-sm text-[var(--dpf-text)]">
        <h3 id={titleId} className="font-medium">Flow</h3>
        <p className="font-mono text-xs text-[var(--dpf-text-secondary)] break-words">{model.signature}</p>
        <p className="text-[var(--dpf-muted)]">
          This shape runs some steps in parallel. The steps are listed below; the drawn map shows parallel branches once it can draw them exactly.
        </p>
      </section>
    );
  }

  const stages = model.stages;
  const lastX = colX(stages.length - 1) + BOX_W;
  const endX = lastX + 72;
  const width = endX + 48;
  const lanesBottom = TOP + LANES.length * LANE_H;
  const height = lanesBottom + TIMING_H + 8;
  const firstY = stages[0] ? laneY(stages[0].lane) : laneY("AI");
  const trigger = model.triggers[0];

  const summary = stages
    .map((stage) => `${stage.title}: ${STATE_LABEL[stage.state]}${stage.room ? `, ${formatDuration(stage.room.dwellMs)}` : ""}`)
    .join("; ");

  return (
    <section aria-labelledby={titleId} className="space-y-2 text-sm text-[var(--dpf-text)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={titleId} className="font-medium">Flow</h3>
        <p className="text-xs text-[var(--dpf-muted)]">{model.shapeRef}</p>
      </div>
      <p className="font-mono text-xs text-[var(--dpf-text-secondary)] break-words">{model.signature}</p>
      <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <svg
          role="group"
          aria-label={`Flow map. ${summary}`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
        >
          {LANES.map((lane, index) => (
            <g key={lane.key}>
              <rect
                x={0}
                y={TOP + index * LANE_H}
                width={width}
                height={LANE_H}
                fill={index % 2 === 0 ? "var(--dpf-surface-2)" : "var(--dpf-surface-1)"}
              />
              <text x={12} y={TOP + index * LANE_H + 20} fontSize={11} fontWeight={600} fill="var(--dpf-muted)">
                {lane.label}
              </text>
            </g>
          ))}

          {trigger ? (
            <g aria-hidden="true">
              <circle cx={LABEL_W + 18} cy={firstY + BOX_H / 2 + 12} r={14} fill="var(--dpf-surface-1)" stroke="var(--dpf-text)" strokeWidth={1.5} />
              <text x={LABEL_W + 18} y={firstY + BOX_H / 2 + 17} fontSize={13} textAnchor="middle" fill="var(--dpf-text)">
                {TRIGGER_GLYPH[trigger]}
              </text>
            </g>
          ) : null}

          {stages.map((stage, index) => {
            const x = colX(index);
            const y = laneY(stage.lane) + 12;
            const fromX = index === 0 ? LABEL_W + 32 : colX(index - 1) + BOX_W + (stages[index - 1]!.governed ? 44 : 0);
            const fromY = index === 0 ? firstY + BOX_H / 2 + 12 : laneY(stages[index - 1]!.lane) + 12 + BOX_H / 2;
            const midX = x - 14;
            return (
              <path
                key={`edge-${stage.key}`}
                d={`M${fromX} ${fromY} H${midX} V${y + BOX_H / 2} H${x - 2}`}
                fill="none"
                stroke="var(--dpf-muted)"
                strokeWidth={1.25}
                markerEnd={`url(#${titleId}-arrow)`}
                aria-hidden="true"
              />
            );
          })}

          {stages.map((stage, index) => {
            const x = colX(index);
            const y = laneY(stage.lane) + 12;
            const style = STATE_STYLE[stage.state];
            const isSelected = selected === stage.key;
            const cause = causeLabel(stage.holdCause);
            const stateText = stage.queue ? (stage.queue.wip === 0 ? "No rooms here" : `${stage.queue.wip} rooms here, ${stage.queue.depth} waiting`) : STATE_LABEL[stage.state];
            const label = `${stage.title}. ${stateText}${cause ? `: ${cause}` : ""}.${stage.room ? ` This room ${stage.room.open ? "has been here" : "took"} ${formatDuration(stage.room.dwellMs)}.` : ""}${stage.typical ? ` Typical ${formatDuration(stage.typical.dwellMs)}.` : ""}${stage.governed ? ` A person decides the way out (${stage.principalRef}).` : ""}`;
            return (
              <g
                key={stage.key}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={isSelected}
                className="cursor-pointer focus:outline-none [&:focus-visible>rect.box]:stroke-[var(--dpf-accent)]"
                onClick={() => select(stage.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(stage.key);
                  }
                }}
              >
                {stage.touchesOutside ? (
                  <g aria-hidden="true">
                    <path d={`M${x + BOX_W / 2} ${y} V${TOP + LANE_H - 18}`} stroke="var(--dpf-accent)" strokeDasharray="3 3" fill="none" />
                    <rect x={x + BOX_W / 2 - 44} y={TOP + LANE_H - 40} width={88} height={22} rx={11} fill="var(--dpf-surface-1)" stroke="var(--dpf-accent)" />
                    <text x={x + BOX_W / 2} y={TOP + LANE_H - 25} fontSize={11} textAnchor="middle" fill="var(--dpf-text)">touchpoint</text>
                  </g>
                ) : null}
                <rect
                  className="box"
                  x={x}
                  y={y}
                  width={BOX_W}
                  height={BOX_H}
                  rx={8}
                  fill={isSelected ? "var(--dpf-accent-soft)" : "var(--dpf-surface-1)"}
                  stroke={style.stroke}
                  strokeWidth={isSelected ? style.width + 1 : style.width}
                  strokeDasharray={style.dash}
                />
                <text x={x + 10} y={y + 17} fontSize={12} fontWeight={500} fill={stage.state === "ahead" ? "var(--dpf-muted)" : "var(--dpf-text)"}>
                  {stage.title.length > 18 ? `${stage.title.slice(0, 17)}…` : stage.title}
                </text>
                <text x={x + 10} y={y + 32} fontSize={10.5} fill="var(--dpf-text-secondary)">
                  {stage.queue ? (stage.queue.wip > 0 ? `${stage.queue.wip} in step` : "—") : `${style.glyph ? `${style.glyph} ` : ""}${cause ?? STATE_LABEL[stage.state]}`}
                </text>
                {stage.governed ? (
                  <g aria-hidden="true">
                    <path d={`M${x + BOX_W} ${y + BOX_H / 2} H${x + BOX_W + 10}`} stroke="var(--dpf-muted)" />
                    <path
                      d={`M${x + BOX_W + 26} ${y + BOX_H / 2 - 16} L${x + BOX_W + 42} ${y + BOX_H / 2} L${x + BOX_W + 26} ${y + BOX_H / 2 + 16} L${x + BOX_W + 10} ${y + BOX_H / 2} Z`}
                      fill="var(--dpf-surface-1)"
                      stroke="var(--dpf-text)"
                      strokeWidth={1.5}
                    />
                    <text x={x + BOX_W + 26} y={y + BOX_H / 2 + 4} fontSize={10} textAnchor="middle" fill="var(--dpf-text)">◇</text>
                  </g>
                ) : null}
                {timingLines(stage).map((line, lineIndex) => (
                  <text
                    key={line.text}
                    x={x}
                    y={lanesBottom + 18 + lineIndex * 15}
                    fontSize={11}
                    fontWeight={line.tone === "warning" ? 600 : 400}
                    fill={line.tone === "warning" ? "var(--dpf-warning)" : line.tone === "muted" ? "var(--dpf-muted)" : "var(--dpf-text)"}
                  >
                    {line.text}{line.tone === "warning" && !stage.queue ? " · slow" : ""}
                  </text>
                ))}
              </g>
            );
          })}

          {stages.length > 0 ? (
            <g aria-hidden="true">
              <path
                d={`M${lastX + (stages.at(-1)!.governed ? 44 : 0)} ${laneY(stages.at(-1)!.lane) + 12 + BOX_H / 2} H${endX - 14}`}
                stroke="var(--dpf-muted)"
                strokeWidth={1.25}
                markerEnd={`url(#${titleId}-arrow)`}
              />
              {model.ends.success ? (
                <circle cx={endX} cy={laneY(stages.at(-1)!.lane) + 12 + BOX_H / 2} r={12} fill="var(--dpf-surface-1)" stroke="var(--dpf-success)" strokeWidth={model.finished ? 4 : 2.5} />
              ) : null}
              {model.ends.failure ? (
                <text x={endX} y={laneY(stages.at(-1)!.lane) + 12 + BOX_H / 2 + 34} fontSize={14} textAnchor="middle" fill="var(--dpf-error)">⊗</text>
              ) : null}
            </g>
          ) : null}

          <defs>
            <marker id={`${titleId}-arrow`} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="var(--dpf-muted)" />
            </marker>
          </defs>
        </svg>
      </div>
      <p className="text-xs text-[var(--dpf-muted)]">
        ▶ being worked · ◷ waiting on a person · ! blocked · ✓ done · ◇ a person decides · ● done · ⊗ declared failure. Times are this room's latest pass; typical is the shape&apos;s last four weeks.
      </p>
    </section>
  );
}
