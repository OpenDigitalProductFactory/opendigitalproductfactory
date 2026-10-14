/**
 * Where a shape's time goes, step by step (BI-C5CD9EAE, EP-B70E718D F4).
 *
 * Spec §4: a Lean VSM data box under each step (in step, waiting, dwell,
 * process, first-pass yield), an inventory triangle for rooms not being
 * worked, a timeline ladder with process time above and wait below, and
 * Camunda-style heat against the step's own four-week baseline. Rendered under
 * the shape map in the area drill-in; the model is computed by
 * lib/work-management/shape-step-measures.ts.
 */
import { Surface } from "@/components/ui/Surface";
import { formatDuration } from "@/lib/datetime";
import { HEAT_RECENT_DAYS, type ShapeStepMeasures as Measures, type StepMeasures } from "@/lib/work-management/shape-step-measures";
import { MIN_BASELINE_EXITS } from "@/lib/work-management/workroom-flow-map";

import type { FlowT } from "./AreaFlowPanel";

const pct = (n: number) => `${Math.round(n * 100)}%`;

function Heat({ step, t }: { step: StepMeasures; t: FlowT }) {
  if (!step.heat || step.heat.direction === "steady") return null;
  const hotter = step.heat.direction === "hotter";
  return (
    <p className={`text-xs font-medium ${hotter ? "text-[var(--dpf-warning)]" : "text-[var(--dpf-success)]"}`}>
      {t(hotter ? "flow.steps.hotter" : "flow.steps.cooler", {
        days: HEAT_RECENT_DAYS,
        recent: formatDuration(step.heat.recentDwellMs),
        baseline: formatDuration(step.heat.baselineDwellMs),
      })}
    </p>
  );
}

function DataBox({ step, t }: { step: StepMeasures; t: FlowT }) {
  const measured = step.dwellMs != null;
  return (
    <Surface as="li" level={1} padding="sm" className="min-w-0 space-y-1">
      <p className="truncate text-sm font-medium text-[var(--dpf-text)]" title={step.title}>{step.title}</p>
      <p className="text-xs text-[var(--dpf-text-secondary)]">
        <span aria-hidden="true">▽ </span>
        {t("flow.steps.queue", { waiting: step.queue.depth, inStep: step.queue.wip })}
      </p>
      {measured ? (
        <dl className="grid grid-cols-2 gap-x-2 text-xs tabular-nums">
          <dt className="text-[var(--dpf-muted)]">{t("flow.steps.dwell")}</dt>
          <dd className="text-end text-[var(--dpf-text)]">{formatDuration(step.dwellMs!)}</dd>
          <dt className="text-[var(--dpf-muted)]">{t("flow.steps.process")}</dt>
          <dd className="text-end text-[var(--dpf-text)]">{step.processMs == null ? "—" : formatDuration(step.processMs)}</dd>
          <dt className="text-[var(--dpf-muted)]">{t("flow.steps.firstPass")}</dt>
          <dd className="text-end text-[var(--dpf-text)]">{step.firstPassYield == null ? "—" : pct(step.firstPassYield)}</dd>
        </dl>
      ) : (
        <p className="text-xs text-[var(--dpf-muted)]">{t("flow.steps.tooFew", { exits: step.exits, min: MIN_BASELINE_EXITS })}</p>
      )}
      <Heat step={step} t={t} />
    </Surface>
  );
}

/** VSM timeline ladder: each step's process time on the upper rung, its wait on the lower. */
function Ladder({ measures, t }: { measures: Measures; t: FlowT }) {
  const { ladder } = measures;
  if (!ladder) return <p className="text-xs text-[var(--dpf-muted)]">{t("flow.steps.noLadder", { min: MIN_BASELINE_EXITS })}</p>;
  const titleOf = new Map(measures.steps.map((s) => [s.key, s.title]));
  return (
    <div className="space-y-2">
      <ol aria-label={t("flow.steps.ladderLabel")} className="flex gap-1 overflow-x-auto pb-1 text-xs tabular-nums">
        {ladder.steps.map((s) => (
          <li key={s.key} className="flex min-w-[7rem] flex-1 flex-col">
            <span className="truncate pb-1 font-medium text-[var(--dpf-text-secondary)]" title={titleOf.get(s.key)}>{titleOf.get(s.key)}</span>
            {/* The upper rung is the step's process time, the lower its wait (VSM timeline). */}
            <span className="border-t-2 border-[var(--dpf-accent)] py-1 text-[var(--dpf-text)]">
              <span className="sr-only">{t("flow.steps.process")}: </span>{formatDuration(s.processMs)}
            </span>
            <span className="mt-4 border-b-2 border-[var(--dpf-warning)] py-1 text-[var(--dpf-text-secondary)]">
              <span className="sr-only">{t("flow.steps.wait")}: </span>{formatDuration(s.waitMs)}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-[var(--dpf-text-secondary)]">
        {t("flow.steps.ladderTotal", {
          process: formatDuration(ladder.processMs),
          wait: formatDuration(ladder.waitMs),
          efficiency: pct(ladder.flowEfficiency),
        })}
        {ladder.unmeasured > 0 ? ` ${t("flow.steps.ladderUnmeasured", { count: ladder.unmeasured })}` : ""}
      </p>
    </div>
  );
}

export function ShapeStepMeasures({ measures, t }: { measures: Measures; t: FlowT }) {
  return (
    <section aria-labelledby="shape-steps-heading" className="space-y-3">
      <h3 id="shape-steps-heading" className="text-sm font-medium text-[var(--dpf-text)]">{t("flow.steps.heading")}</h3>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {measures.steps.map((step) => <DataBox key={step.key} step={step} t={t} />)}
      </ul>
      <Ladder measures={measures} t={t} />
    </section>
  );
}
