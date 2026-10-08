import Link from "next/link";

import { KpiCard } from "@/components/ui/report-kit/KpiCard";
import { WorkroomFlowMap } from "@/components/workspace/workroom/WorkroomFlowMap";
import type { PortfolioFlowWithCost, ShapeFlowView } from "@/lib/work-management/area-flow.server";
import { FLOW_ITEM_TYPES, FLOW_WINDOW_DAYS, type FlowItemType } from "@/lib/work-management/portfolio-flow";
import { getWorkShape } from "@/lib/work-management/work-shapes";
import { formatDuration } from "@/lib/work-management/workroom-flow-map";

const ITEM_TYPE: Record<FlowItemType, { label: string; color: string }> = {
  feature: { label: "Feature", color: "var(--dpf-accent)" },
  defect: { label: "Defect", color: "var(--dpf-error)" },
  risk: { label: "Risk", color: "var(--dpf-warning)" },
  debt: { label: "Debt", color: "var(--dpf-muted)" },
};

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

function delta(current: number | null, prior: number | null, format: (n: number) => string, lowerIsBetter: boolean) {
  if (current == null || prior == null) return null;
  const diff = current - prior;
  if (Math.abs(diff) < 1e-9) return <span className="text-[var(--dpf-muted)]">no change vs prior {FLOW_WINDOW_DAYS} days</span>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={better ? "text-[var(--dpf-success)]" : "text-[var(--dpf-warning)]"}>
      {diff > 0 ? "+" : "−"}{format(Math.abs(diff))} vs prior {FLOW_WINDOW_DAYS} days
    </span>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The five flow measures for one portfolio (or the unplaced rooms), and its shapes. */
export function PortfolioFlowTiles({ flow, areaHref }: { flow: PortfolioFlowWithCost; areaHref: string }) {
  const typed = FLOW_ITEM_TYPES.reduce((sum, type) => sum + flow.distribution[type], 0);
  return (
    <section aria-labelledby="area-flow-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="area-flow-heading" className="text-base font-semibold text-[var(--dpf-text)]">How the work flows</h2>
        <p className="text-xs text-[var(--dpf-muted)]">Last {FLOW_WINDOW_DAYS} days · {flow.rooms} live rooms</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard size="sm" value={flow.flowLoad} label="In flow now" hint="Rooms being worked, waiting on a person, or blocked" />
        <KpiCard
          size="sm"
          value={flow.flowTime.p50Ms == null ? "—" : formatDuration(flow.flowTime.p50Ms)}
          label="Flow time (median)"
          hint={
            <span className="flex flex-col gap-1">
              {flow.flowTime.runs > 0 ? `${flow.flowTime.runs} runs finished` : "No runs finished yet"}
              {delta(flow.flowTime.p50Ms, flow.flowTime.priorP50Ms, formatDuration, true)}
              <Trend values={flow.weeklyFlowTimeP50Ms} label="Median flow time per week, last 8 weeks" />
            </span>
          }
        />
        <KpiCard
          size="sm"
          value={flow.flowEfficiency.value == null ? "—" : pct(flow.flowEfficiency.value)}
          label="Flow efficiency"
          hint={<span className="flex flex-col gap-1">Share of step time spent working{delta(flow.flowEfficiency.value, flow.flowEfficiency.prior, (n) => `${Math.round(n * 100)} pts`, false)}</span>}
        />
        <KpiCard
          size="sm"
          value={flow.throughput.perWeek.toFixed(1)}
          label="Finished per week"
          hint={delta(flow.throughput.perWeek, flow.throughput.priorPerWeek, (n) => n.toFixed(1), false) ?? "Runs that reached a success stop"}
        />
        <KpiCard
          size="sm"
          value={flow.points ? `${flow.points.inFlight} pts` : "—"}
          label="Cost in flight"
          hint={[
            flow.points ? `${flow.points.delivered} pts delivered this quarter` : "Unplaced rooms carry no portfolio budget",
            flow.aiUsd == null ? "AI spend unavailable" : `AI $${flow.aiUsd.toFixed(2)} on these rooms, last ${FLOW_WINDOW_DAYS} days`,
          ].join(" · ")}
        />
      </div>
      {typed > 0 ? (
        <div className="space-y-1">
          <div className="flex h-2 overflow-hidden rounded bg-[var(--dpf-surface-2)]" role="img"
            aria-label={`Rooms in flow by type: ${FLOW_ITEM_TYPES.map((t) => `${ITEM_TYPE[t].label} ${flow.distribution[t]}`).join(", ")}`}>
            {FLOW_ITEM_TYPES.map((type) => flow.distribution[type] > 0 ? (
              <span key={type} style={{ width: `${(flow.distribution[type] / typed) * 100}%`, background: ITEM_TYPE[type].color }} />
            ) : null)}
          </div>
          <p className="flex flex-wrap gap-x-4 text-xs text-[var(--dpf-muted)]">
            {FLOW_ITEM_TYPES.map((type) => <span key={type}>{ITEM_TYPE[type].label} {flow.distribution[type]}</span>)}
          </p>
        </div>
      ) : null}
      {flow.shapes.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm text-[var(--dpf-text)]">
            <caption className="sr-only">Work shapes in this area</caption>
            <thead className="text-xs text-[var(--dpf-muted)]">
              <tr>
                <th scope="col" className="py-2 pe-3 font-medium">Shape</th>
                <th scope="col" className="py-2 pe-3 font-medium">In flow</th>
                <th scope="col" className="py-2 pe-3 font-medium">Flow time</th>
                <th scope="col" className="py-2 font-medium">Where it waits</th>
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
                    {shape.bottleneck ? `${shape.bottleneck.roomsHeld} at ${shape.bottleneck.stageKey} · ${shape.bottleneck.cause.replaceAll("_", " ")}` : "Nothing waiting"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--dpf-muted)]">No rooms in this area are in flow right now.</p>
      )}
    </section>
  );
}

/** One shape version drawn across every room on it, with before/after versions and the rooms at a step. */
export function ShapeFlowDrillIn({ view, backHref, baseHref, stageKey }: { view: ShapeFlowView; backHref: string; baseHref: string; stageKey: string | null }) {
  const { model } = view;
  const [key, version] = model.shapeRef.split("@");
  return (
    <section aria-labelledby="shape-flow-heading" className="space-y-3">
      <Link href={backHref} className="text-xs font-medium text-[var(--dpf-accent)] hover:underline">← All shapes in this area</Link>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="shape-flow-heading" className="text-base font-semibold text-[var(--dpf-text)]">{model.title}</h2>
        {view.versions.length > 1 ? (
          <nav aria-label="Shape version" className="flex flex-wrap gap-2 text-xs">
            {view.versions.map((v) => (
              <Link key={v} href={`${baseHref}&shape=${encodeURIComponent(key!)}&version=${encodeURIComponent(v)}`}
                aria-current={v === version ? "page" : undefined}
                className={`rounded border px-2 py-1 ${v === version ? "border-[var(--dpf-accent)] text-[var(--dpf-accent)]" : "border-[var(--dpf-border)] text-[var(--dpf-text-secondary)]"}`}>
                v{v}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
      <p className="text-xs text-[var(--dpf-muted)]">{model.aggregate?.roomsInFlow ?? 0} rooms in flow on v{version}. Choose a step to see its rooms.</p>
      <WorkroomFlowMap model={model} selectParam="stage" />
      {view.roomsAtStep ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-[var(--dpf-text)]">Rooms at {stageKey}</h3>
          {view.roomsAtStep.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No rooms are at this step now.</p>
          ) : (
            <ul className="divide-y divide-[var(--dpf-border)] text-sm">
              {view.roomsAtStep.map((room) => (
                <li key={room.capsuleId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <Link href={room.href} className="text-[var(--dpf-accent)] hover:underline">{room.title}</Link>
                  <span className="text-xs text-[var(--dpf-text-secondary)]">
                    {room.state === "working" ? "Being worked" : room.state === "awaiting-person" ? "Waiting on a person" : `Blocked: ${(room.cause ?? "").replaceAll("_", " ")}`}
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

const PORTFOLIO_LABEL: Record<PortfolioFlowWithCost["key"], string> = {
  productsAndServicesSold: "Goods and services for sale",
  manufactureAndDeliver: "Manufacturing and delivery",
  forEmployees: "Workforce",
  foundational: "Foundational",
  unplaced: "Unplaced",
};

/** The four portfolios (and unplaced rooms) side by side on the same five measures. */
export function PortfolioFlowComparison({ flows, areaHrefByRole }: { flows: PortfolioFlowWithCost[]; areaHrefByRole: Partial<Record<string, string>> }) {
  const rows: { label: string; value: (f: PortfolioFlowWithCost) => string }[] = [
    { label: "In flow now", value: (f) => String(f.flowLoad) },
    { label: "Flow time (median)", value: (f) => (f.flowTime.p50Ms == null ? "—" : formatDuration(f.flowTime.p50Ms)) },
    { label: "Flow efficiency", value: (f) => (f.flowEfficiency.value == null ? "—" : pct(f.flowEfficiency.value)) },
    { label: "Finished per week", value: (f) => f.throughput.perWeek.toFixed(1) },
    { label: "Points in flight", value: (f) => (f.points ? String(f.points.inFlight) : "—") },
    { label: `AI spend (${FLOW_WINDOW_DAYS} days)`, value: (f) => (f.aiUsd == null ? "—" : `$${f.aiUsd.toFixed(2)}`) },
  ];
  return (
    <section aria-labelledby="portfolio-flow-heading" className="my-6 space-y-2">
      <h2 id="portfolio-flow-heading" className="text-base font-semibold text-[var(--dpf-text)]">How work flows in each portfolio</h2>
      <p className="text-xs text-[var(--dpf-muted)]">Last {FLOW_WINDOW_DAYS} days. Rooms with no portfolio are shown on their own, never counted in another.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm text-[var(--dpf-text)]">
          <thead>
            <tr className="text-xs text-[var(--dpf-muted)]">
              <th scope="col" className="py-2 pe-3 font-medium"><span className="sr-only">Measure</span></th>
              {flows.map((f) => (
                <th key={f.key} scope="col" className="py-2 pe-3 font-medium">
                  {areaHrefByRole[f.key] ? <Link className="text-[var(--dpf-accent)] hover:underline" href={areaHrefByRole[f.key]!}>{PORTFOLIO_LABEL[f.key]}</Link> : PORTFOLIO_LABEL[f.key]}
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
