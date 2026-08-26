import { CircleDashed, CircleSlash, Clock, Check, CircleDot } from "lucide-react";

import type { ShapeGraph, ShapeNodeState, ShapeRow, ShapeStage } from "@/lib/work-management/shape-projection";

type Props = {
  graph: ShapeGraph;
};

/**
 * BI-23DB08BB / BI-405AD4FD. The room's gates as a picture: stages left to
 * right, concurrent rows clustered inside a stage, one status mark per row.
 *
 * State is encoded in FORM (icon + border weight) as well as colour, so the
 * blocking stage reads before any label does and survives a colourblind reader.
 * Colour comes from --dpf-* tokens only.
 */
const STATE_ICON: Record<ShapeNodeState, typeof Check> = {
  passed: Check,
  holding: CircleDot,
  denied: CircleSlash,
  "awaiting-confirmation": Clock,
  "not-reached": CircleDashed,
};

const STATE_LABEL: Record<ShapeNodeState, string> = {
  passed: "Passed",
  holding: "Holding",
  denied: "Declined",
  "awaiting-confirmation": "Awaiting a person",
  "not-reached": "Not reached",
};

const STATE_TONE: Record<ShapeNodeState, string> = {
  passed: "text-[var(--dpf-success)]",
  holding: "text-[var(--dpf-warning)]",
  denied: "text-[var(--dpf-error)]",
  "awaiting-confirmation": "text-[var(--dpf-warning)]",
  "not-reached": "text-[var(--dpf-muted)]",
};

function StateMark({ state }: { state: ShapeNodeState }) {
  const Icon = STATE_ICON[state];
  return (
    <Icon
      className={`size-4 shrink-0 ${STATE_TONE[state]}`}
      aria-hidden="true"
    />
  );
}

function Row({ row }: { row: ShapeRow }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <StateMark state={row.state} />
      <span className="min-w-0 flex-1 truncate text-[var(--dpf-text)]">{row.label}</span>
      {row.detail ? (
        <span className="shrink-0 text-xs text-[var(--dpf-muted)]">{row.detail}</span>
      ) : null}
      <span className="sr-only">{STATE_LABEL[row.state]}</span>
    </li>
  );
}

function Stage({ stage, blocking }: { stage: ShapeStage; blocking: boolean }) {
  return (
    <li
      className={`min-w-56 flex-1 rounded-lg border p-3 ${
        blocking
          ? "border-2 border-[var(--dpf-warning)]"
          : "border border-[var(--dpf-border)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <StateMark state={stage.state} />
        <h3 className="text-sm font-medium text-[var(--dpf-text)]">{stage.label}</h3>
        <span className="ml-auto text-xs text-[var(--dpf-muted)]">
          {STATE_LABEL[stage.state]}
        </span>
      </div>
      {stage.rows.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {stage.rows.map((row) => <Row key={row.key} row={row} />)}
        </ul>
      ) : (
        // Showing less is deliberate: where the gate recorded nothing, the
        // picture says nothing rather than inventing a verdict.
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">No records yet</p>
      )}
    </li>
  );
}

export function WorkroomShape({ graph }: Props) {
  return (
    <section aria-labelledby="workroom-shape-title" className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="workroom-shape-title" className="text-base font-semibold text-[var(--dpf-text)]">
          Shape
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          {graph.progress.passed} of {graph.progress.total} stages passed
          {graph.blockingStageKey ? ` · holding at ${graph.blockingStageKey}` : ""}
        </p>
      </div>
      {/* The canvas scrolls on its own so the page body never scrolls sideways. */}
      <div
        aria-labelledby="workroom-shape-title"
        tabIndex={0}
        className="mt-3 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
      >
        <ul className="flex min-w-max gap-3">
          {graph.stages.map((stage) => (
            <Stage
              key={stage.key}
              stage={stage}
              blocking={graph.blockingStageKey === stage.key}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
