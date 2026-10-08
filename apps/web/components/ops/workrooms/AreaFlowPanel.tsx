import Link from "next/link";

import type { MessageArgs, MessageKey } from "@dpf/i18n";

import { KpiCard } from "@/components/ui/report-kit/KpiCard";
import { WorkroomFlowMap } from "@/components/workspace/workroom/WorkroomFlowMap";
import type { PortfolioFlowWithCost, ShapeFlowView } from "@/lib/work-management/area-flow.server";
import { FLOW_ITEM_TYPES, FLOW_WINDOW_DAYS, type FlowItemType } from "@/lib/work-management/portfolio-flow";
import { getWorkShape } from "@/lib/work-management/work-shapes";
import { formatDuration } from "@/lib/datetime";
import { formatMoney } from "@/lib/org-locale/org-locale";
import { describeHoldCause } from "@/lib/work-management/workroom-stage-telemetry";

/** Translator for the `workrooms` namespace (server: `await getT("workrooms")`). */
export type FlowT = (key: MessageKey<"workrooms">, args?: MessageArgs) => string;

const ITEM_COLOR: Record<FlowItemType, string> = {
  feature: "var(--dpf-accent)",
  defect: "var(--dpf-error)",
  risk: "var(--dpf-warning)",
  debt: "var(--dpf-muted)",
};

const usd = (amount: number) => formatMoney(amount, "USD", null, { maximumFractionDigits: 2 });

/** Median flow time per week; gaps where a week finished nothing. */
function Trend({ values, label }: { values: (number | null)[]; label: string }) {
  const known = values.filter((v): v is number => v != null);
  if (known.length < 2) return null;
  const w = 96;
  const h = 24;
  const max = Math.max(...known);
  const min = Math.min(...known);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => (v == null ? null : { x: i * step, y: h - 3 - ((v - min) / span) * (h - 6) }));
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
    pen = true;
  }
  const last = [...points].reverse().find(Boolean)!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--dpf-accent)" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={2.5} fill="var(--dpf-accent)" />
    </svg>
  );
}

function delta(t: FlowT, current: number | null, prior: number | null, format: (n: number) => string, lowerIsBetter: boolean) {
  if (current == null || prior == null) return null;
  const diff = current - prior;
  if (Math.abs(diff) < 1e-9) return <span className="text-[var(--dpf-muted)]">{t("flow.noChange", { days: FLOW_WINDOW_DAYS })}</span>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={better ? "text-[var(--dpf-success)]" : "text-[var(--dpf-warning)]"}>
      {t("flow.changeVsPrior", { delta: `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))}`, days: FLOW_WINDOW_DAYS })}
    </span>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The five flow measures for one portfolio (or the unplaced rooms), and its shapes. */
export function PortfolioFlowTiles({ flow, areaHref, t }: { flow: PortfolioFlowWithCost; areaHref: string; t: FlowT }) {
  const typed = FLOW_ITEM_TYPES.reduce((sum, type) => sum + flow.distribution[type], 0);
  const costHint = [
    flow.points ? t("flow.deliveredPoints", { points: flow.points.delivered }) : t("flow.noBudget"),
    flow.aiUsd == null ? t("flow.aiUnavailable") : t("flow.aiSpend", { amount: usd(flow.aiUsd), days: FLOW_WINDOW_DAYS }),
  ].join(" · ");
  return (
    <section aria-labelledby="area-flow-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="area-flow-heading" className="text-base font-semibold text-[var(--dpf-text)]">{t("flow.heading")}</h2>
        <p className="text-xs text-[var(--dpf-muted)]">{t("flow.windowRooms", { days: FLOW_WINDOW_DAYS, rooms: flow.rooms })}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard size="sm" value={flow.flowLoad} label={t("flow.inFlow")} hint={t("flow.inFlowHint")} />
        <KpiCard
          size="sm"
          value={flow.flowTime.p50Ms == null ? "—" : formatDuration(flow.flowTime.p50Ms)}
          label={t("flow.flowTime")}
          hint={
            <span className="flex flex-col gap-1">
              {flow.flowTime.runs > 0 ? t("flow.runsFinished", { count: flow.flowTime.runs }) : t("flow.noRuns")}
              {delta(t, flow.flowTime.p50Ms, flow.flowTime.priorP50Ms, formatDuration, true)}
              <Trend values={flow.weeklyFlowTimeP50Ms} label={t("flow.trendLabel")} />
            </span>
          }
        />
        <KpiCard
          size="sm"
          value={flow.flowEfficiency.value == null ? "—" : pct(flow.flowEfficiency.value)}
          label={t("flow.efficiency")}
          hint={<span className="flex flex-col gap-1">{t("flow.efficiencyHint")}{delta(t, flow.flowEfficiency.value, flow.flowEfficiency.prior, (n) => `${Math.round(n * 100)} pts`, false)}</span>}
        />
        <KpiCard
          size="sm"
          value={flow.throughput.perWeek.toFixed(1)}
          label={t("flow.perWeek")}
          hint={delta(t, flow.throughput.perWeek, flow.throughput.priorPerWeek, (n) => n.toFixed(1), false) ?? t("flow.perWeekHint")}
        />
        <KpiCard size="sm" value={flow.points ? t("flow.points", { points: flow.points.inFlight }) : "—"} label={t("flow.cost")} hint={costHint} />
      </div>
      {typed > 0 ? (
        <div className="space-y-1">
          <div className="flex h-2 overflow-hidden rounded bg-[var(--dpf-surface-2)]" role="img"
            aria-label={t("flow.mixLabel", { mix: FLOW_ITEM_TYPES.map((type) => `${t(`flow.types.${type}`)} ${flow.distribution[type]}`).join(", ") })}>
            {FLOW_ITEM_TYPES.map((type) => flow.distribution[type] > 0 ? (
              <span key={type} style={{ width: `${(flow.distribution[type] / typed) * 100}%`, background: ITEM_COLOR[type] }} />
            ) : null)}
          </div>
          <p className="flex flex-wrap gap-x-4 text-xs text-[var(--dpf-muted)]">
            {FLOW_ITEM_TYPES.map((type) => <span key={type}>{`${t(`flow.types.${type}`)} ${flow.distribution[type]}`}</span>)}
          </p>
        </div>
      ) : null}
      {flow.shapes.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-start text-sm text-[var(--dpf-text)]">
            <caption className="sr-only">{t("flow.shapesCaption")}</caption>
            <thead className="text-xs text-[var(--dpf-muted)]">
              <tr>
                <th scope="col" className="py-2 pe-3 font-medium">{t("flow.colShape")}</th>
                <th scope="col" className="py-2 pe-3 font-medium">{t("flow.colInFlow")}</th>
                <th scope="col" className="py-2 pe-3 font-medium">{t("flow.colFlowTime")}</th>
                <th scope="col" className="py-2 font-medium">{t("flow.colWaits")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dpf-border)]">
              {flow.shapes.map((shape) => (
                <tr key={shape.shapeRef}>
                  <td className="py-2 pe-3">
                    <Link className="text-[var(--dpf-accent)] hover:underline" href={`${areaHref}&shape=${encodeURIComponent(shape.shapeKey)}`}>
                      {getWorkShape(shape.shapeKey)?.title ?? shape.shapeKey}
                    </Link>
                  </td>
                  <td className="py-2 pe-3 tabular-nums">{shape.roomsInFlow}</td>
                  <td className="py-2 pe-3 tabular-nums">{shape.flowTimeP50Ms == null ? "—" : formatDuration(shape.flowTimeP50Ms)}</td>
                  <td className="py-2 text-[var(--dpf-text-secondary)]">
                    {shape.bottleneck
                      ? t("flow.bottleneck", { count: shape.bottleneck.roomsHeld, stage: shape.bottleneck.stageKey, cause: describeHoldCause(shape.bottleneck.cause) })
                      : t("flow.nothingWaiting")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--dpf-muted)]">{t("flow.noneInFlowArea")}</p>
      )}
    </section>
  );
}

/** One shape version drawn across every room on it, with before/after versions and the rooms at a step. */
export function ShapeFlowDrillIn({ view, backHref, baseHref, stageKey, t }: { view: ShapeFlowView; backHref: string; baseHref: string; stageKey: string | null; t: FlowT }) {
  const { model } = view;
  const [key, version] = model.shapeRef.split("@");
  return (
    <section aria-labelledby="shape-flow-heading" className="space-y-3">
      <Link href={backHref} className="text-xs font-medium text-[var(--dpf-accent)] hover:underline">{t("flow.back")}</Link>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="shape-flow-heading" className="text-base font-semibold text-[var(--dpf-text)]">{model.title}</h2>
        {view.versions.length > 1 ? (
          <nav aria-label={t("flow.versionNav")} className="flex flex-wrap gap-2 text-xs">
            {view.versions.map((v) => (
              <Link key={v} href={`${baseHref}&shape=${encodeURIComponent(key!)}&version=${encodeURIComponent(v)}`}
                aria-current={v === version ? "page" : undefined}
                className={`rounded border px-2 py-1 ${v === version ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)]" : "border-[var(--dpf-border)] text-[var(--dpf-text-secondary)]"}`}>
                {t("flow.version", { version: v })}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
      <p className="text-xs text-[var(--dpf-muted)]">{t("flow.roomsInFlowOn", { count: model.aggregate?.roomsInFlow ?? 0, version: version ?? "" })}</p>
      <WorkroomFlowMap model={model} selectParam="stage" />
      {view.roomsAtStep ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--dpf-text)]">{t("flow.roomsAt", { stage: stageKey ?? "" })}</h3>
          {view.roomsAtStep.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">{t("flow.noRoomsAtStep")}</p>
          ) : (
            <ul className="divide-y divide-[var(--dpf-border)] text-sm">
              {view.roomsAtStep.map((room) => (
                <li key={room.capsuleId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <Link href={room.href} className="text-[var(--dpf-accent)] hover:underline">{room.title}</Link>
                  <span className="text-xs text-[var(--dpf-text-secondary)]">
                    {room.state === "working" ? t("flow.working") : room.state === "awaiting-person" ? t("flow.waitingPerson") : t("flow.blocked", { cause: describeHoldCause(room.cause) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** The four portfolios (and unplaced rooms) side by side on the same five measures. */
export function PortfolioFlowComparison({ flows, areaHrefByRole, t }: { flows: PortfolioFlowWithCost[]; areaHrefByRole: Partial<Record<string, string>>; t: FlowT }) {
  const rows: { label: string; value: (f: PortfolioFlowWithCost) => string }[] = [
    { label: t("flow.inFlow"), value: (f) => String(f.flowLoad) },
    { label: t("flow.flowTime"), value: (f) => (f.flowTime.p50Ms == null ? "—" : formatDuration(f.flowTime.p50Ms)) },
    { label: t("flow.efficiency"), value: (f) => (f.flowEfficiency.value == null ? "—" : pct(f.flowEfficiency.value)) },
    { label: t("flow.perWeek"), value: (f) => f.throughput.perWeek.toFixed(1) },
    { label: t("flow.pointsInFlight"), value: (f) => (f.points ? String(f.points.inFlight) : "—") },
    { label: t("flow.aiSpendRow", { days: FLOW_WINDOW_DAYS }), value: (f) => (f.aiUsd == null ? "—" : usd(f.aiUsd)) },
  ];
  return (
    <section aria-labelledby="portfolio-flow-heading" className="my-6 space-y-2">
      <h2 id="portfolio-flow-heading" className="text-base font-semibold text-[var(--dpf-text)]">{t("flow.comparisonHeading")}</h2>
      <p className="text-xs text-[var(--dpf-muted)]">{t("flow.comparisonNote", { days: FLOW_WINDOW_DAYS })}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-start text-sm text-[var(--dpf-text)]">
          <thead>
            <tr className="text-xs text-[var(--dpf-muted)]">
              <th scope="col" className="py-2 pe-3 font-medium"><span className="sr-only">{t("flow.measure")}</span></th>
              {flows.map((f) => (
                <th key={f.key} scope="col" className="py-2 pe-3 font-medium">
                  {areaHrefByRole[f.key]
                    ? <Link className="text-[var(--dpf-accent)] hover:underline" href={areaHrefByRole[f.key]!}>{t(`flow.portfolios.${f.key}`)}</Link>
                    : t(`flow.portfolios.${f.key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--dpf-border)]">
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-2 pe-3 font-normal text-[var(--dpf-text-secondary)]">{row.label}</th>
                {flows.map((f) => <td key={f.key} className="py-2 pe-3 tabular-nums">{row.value(f)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
