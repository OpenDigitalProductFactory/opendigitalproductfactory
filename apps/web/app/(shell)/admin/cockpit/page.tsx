// apps/web/app/(shell)/admin/cockpit/page.tsx
//
// Reduction Gear Cockpit — read-only MVP (Phase 0).
//
// Operator-facing gear-train diagnostic surface. First viewport shows the four
// ring interfaces with torque / slip / cost / sample size; below are the slip
// reason rollup, top-N degrading triples, recent events with drill-through,
// and the graduations panel (empty until Phase 1).
//
// Per spec §5.4: dense ops surface, DPF tokens only, no nested cards, every
// number clickable, honest "unknown" state. Phase 0 emits only at Ring 1→2 —
// the other rings show "no data" until their emitters land.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §5
// BI:   BI-85CB31F0

import Link from "next/link";
import { ArrowRight, ArrowUpRight, ArrowDownLeft, AlertTriangle, CheckCircle, Award, GitMerge } from "lucide-react";
import {
  defaultWindow,
  getInterfaceTorqueReadings,
  getSlipByReason,
  getTripleWearReadings,
  getRecentGraduations,
  listRecentGearInterfaceRows,
  type InterfaceTorqueReading,
} from "@/lib/gear-interface";

// All four ring interfaces. Phase 0 only emits at 1→2; the others render as
// "no data" lanes so the operator sees the gear train honestly, not hidden.
const ALL_INTERFACES: Array<{ innerRing: number; outerRing: number; label: string }> = [
  { innerRing: 1, outerRing: 2, label: "Ring 1→2  Coworker → Workflow" },
  { innerRing: 2, outerRing: 3, label: "Ring 2→3  Workflow → Archetype" },
  { innerRing: 3, outerRing: 4, label: "Ring 3→4  Archetype → Sandbox/Prod" },
  { innerRing: 4, outerRing: 5, label: "Ring 4→5  Sandbox/Prod → Hive" },
];

function formatTorque(value: number): string {
  return (value * 100).toFixed(0) + "%";
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function torqueColor(value: number): string {
  if (value >= 0.9) return "#4ade80"; // healthy green
  if (value >= 0.6) return "#fbbf24"; // warning amber
  return "#f87171"; // degraded red
}

function findReadings(
  all: InterfaceTorqueReading[],
  innerRing: number,
  outerRing: number,
): InterfaceTorqueReading[] {
  return all.filter((r) => r.innerRing === innerRing && r.outerRing === outerRing);
}

function summarizeInterface(readings: InterfaceTorqueReading[]) {
  if (readings.length === 0) {
    return null;
  }
  const total = readings.reduce((acc, r) => acc + r.totalRecords, 0);
  const weightedTorque =
    total === 0
      ? 0
      : readings.reduce((acc, r) => acc + r.meanTorqueTechnical * r.totalRecords, 0) / total;
  const slipCount = readings.reduce((acc, r) => acc + r.slipCount, 0);
  const slipRate = total === 0 ? 0 : slipCount / total;
  const totalCost = readings.reduce((acc, r) => acc + r.totalCostUsd, 0);
  const graduations = readings.reduce((acc, r) => acc + r.graduationCount, 0);
  return { total, weightedTorque, slipRate, totalCost, graduations };
}

export default async function CockpitPage({
  searchParams,
}: {
  searchParams?: Promise<{ ring?: string; days?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const days = Math.max(1, Math.min(90, Number(params.days ?? "7") || 7));
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  const window = { start, end: now };

  // Aggregate fetches in parallel — every Cockpit panel reads from the same window
  const [interfaceReadings, slipByReason, wear, graduations, recentRows] = await Promise.all([
    getInterfaceTorqueReadings(window),
    getSlipByReason(window),
    getTripleWearReadings(window, { minSampleSize: 1 }),
    getRecentGraduations(window, { limit: 10 }),
    listRecentGearInterfaceRows(window, {}, { limit: 50 }),
  ]);

  const totalRows = interfaceReadings.reduce((acc, r) => acc + r.totalRecords, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header band ----------------------------------------------------- */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)] flex items-center gap-2">
            <GitMerge size={18} className="text-[var(--dpf-accent)]" />
            Reduction Gear Cockpit
          </h1>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">
            Operator diagnostic view — torque, slip, wear, cost, graduations across the agentic gear train.
            <span className="ml-2 italic">Phase 0 emits at Ring 1→2 only.</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--dpf-muted)]">Window:</span>
          {[1, 7, 30].map((d) => (
            <Link
              key={d}
              href={`?days=${d}`}
              className="px-2 py-1 rounded border text-[var(--dpf-text)]"
              style={{
                borderColor: "var(--dpf-border)",
                background: d === days ? "var(--dpf-surface-2)" : "var(--dpf-surface-1)",
              }}
            >
              {d}d
            </Link>
          ))}
          <span className="text-[var(--dpf-muted)] ml-3">
            {totalRows} record{totalRows === 1 ? "" : "s"} in window
          </span>
        </div>
      </div>

      {/* Ring overview band ----------------------------------------------- */}
      <section
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-1)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">Gear interfaces</h2>
        <div className="space-y-2">
          {ALL_INTERFACES.map(({ innerRing, outerRing, label }) => {
            const outward = findReadings(interfaceReadings, innerRing, outerRing).filter(
              (r) => r.transmissionDirection === "outward",
            );
            const inward = findReadings(interfaceReadings, innerRing, outerRing).filter(
              (r) => r.transmissionDirection === "inward",
            );
            const outSummary = summarizeInterface(outward);
            const inSummary = summarizeInterface(inward);
            const noData = !outSummary && !inSummary;
            return (
              <div
                key={`${innerRing}-${outerRing}`}
                className="flex items-stretch gap-3 px-3 py-2 rounded border"
                style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-2)" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--dpf-text)] flex items-center gap-2">
                    {label}
                    {noData && (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ background: "var(--dpf-bg)", color: "var(--dpf-muted)", border: "1px solid var(--dpf-border)" }}
                      >
                        NO DATA
                      </span>
                    )}
                  </div>
                  {noData && (
                    <div className="text-[11px] text-[var(--dpf-muted)] mt-0.5">
                      {innerRing === 1
                        ? "no records — pilot waiting on a completed Build Studio phase run"
                        : "emitter not active in Phase 0"}
                    </div>
                  )}
                </div>
                {outSummary && (
                  <Link
                    href={`?days=${days}&ring=${innerRing}-${outerRing}&dir=outward`}
                    className="flex items-center gap-3 px-3 rounded hover:underline"
                    style={{ background: "var(--dpf-bg)" }}
                  >
                    <ArrowUpRight size={14} className="text-[var(--dpf-muted)]" />
                    <div className="text-[10px] text-[var(--dpf-muted)] leading-tight">
                      outward
                      <div className="text-[var(--dpf-text)] text-xs font-semibold mt-0.5">
                        {outSummary.total} rec
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--dpf-muted)] leading-tight">
                      torque
                      <div className="text-xs font-semibold mt-0.5" style={{ color: torqueColor(outSummary.weightedTorque) }}>
                        {formatTorque(outSummary.weightedTorque)}
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--dpf-muted)] leading-tight">
                      slip
                      <div className="text-xs font-semibold mt-0.5 text-[var(--dpf-text)]">
                        {formatPercent(outSummary.slipRate)}
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--dpf-muted)] leading-tight">
                      cost
                      <div className="text-xs font-semibold mt-0.5 text-[var(--dpf-text)]">
                        {formatCost(outSummary.totalCost)}
                      </div>
                    </div>
                    {outSummary.graduations > 0 && (
                      <Award size={14} className="text-[var(--dpf-accent)]" aria-label={`${outSummary.graduations} graduations`} />
                    )}
                  </Link>
                )}
                {inSummary && (
                  <Link
                    href={`?days=${days}&ring=${innerRing}-${outerRing}&dir=inward`}
                    className="flex items-center gap-3 px-3 rounded hover:underline"
                    style={{ background: "var(--dpf-bg)" }}
                  >
                    <ArrowDownLeft size={14} className="text-[var(--dpf-muted)]" />
                    <div className="text-[10px] text-[var(--dpf-muted)] leading-tight">
                      inward
                      <div className="text-[var(--dpf-text)] text-xs font-semibold mt-0.5">
                        {inSummary.total} rec
                      </div>
                    </div>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Two-column band: slip rollup + triple wear ----------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section
          className="rounded border p-4"
          style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-1)" }}
        >
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-[var(--dpf-muted)]" />
            Slip by reason
          </h2>
          {slipByReason.length === 0 ? (
            <p className="text-xs text-[var(--dpf-muted)]">
              No slip detected in the window. (Healthy state — or no emitter activity yet.)
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[var(--dpf-muted)] text-left">
                <tr>
                  <th className="font-medium pb-1">Reason</th>
                  <th className="font-medium pb-1 text-right">Count</th>
                  <th className="font-medium pb-1 text-right">Cost burned</th>
                </tr>
              </thead>
              <tbody className="text-[var(--dpf-text)]">
                {slipByReason.map((row) => (
                  <tr key={row.slipReason} className="border-t" style={{ borderColor: "var(--dpf-border)" }}>
                    <td className="py-1.5">{row.slipReason}</td>
                    <td className="py-1.5 text-right">{row.count}</td>
                    <td className="py-1.5 text-right">{formatCost(row.totalCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section
          className="rounded border p-4"
          style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-1)" }}
        >
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3 flex items-center gap-2">
            <CheckCircle size={14} className="text-[var(--dpf-muted)]" />
            Triple wear (lowest torque first)
          </h2>
          {wear.length === 0 ? (
            <p className="text-xs text-[var(--dpf-muted)]">
              No capability×archetype×agent triples observed yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[var(--dpf-muted)] text-left">
                <tr>
                  <th className="font-medium pb-1">Agent</th>
                  <th className="font-medium pb-1">Capability</th>
                  <th className="font-medium pb-1">Archetype</th>
                  <th className="font-medium pb-1 text-right">n</th>
                  <th className="font-medium pb-1 text-right">Torque</th>
                </tr>
              </thead>
              <tbody className="text-[var(--dpf-text)]">
                {wear.slice(0, 10).map((row, i) => (
                  <tr
                    key={`${row.agentIdForTriple}-${row.capabilityName}-${row.archetypeContext ?? "null"}-${i}`}
                    className="border-t"
                    style={{ borderColor: "var(--dpf-border)" }}
                  >
                    <td className="py-1.5 truncate max-w-[140px]">{row.agentIdForTriple}</td>
                    <td className="py-1.5 truncate max-w-[140px]">{row.capabilityName}</td>
                    <td className="py-1.5 text-[var(--dpf-muted)]">{row.archetypeContext ?? "—"}</td>
                    <td className="py-1.5 text-right">{row.sampleSize}</td>
                    <td className="py-1.5 text-right font-semibold" style={{ color: torqueColor(row.meanTorqueTechnical) }}>
                      {formatTorque(row.meanTorqueTechnical)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Graduations band (always present so operators see "no events yet") */}
      <section
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-1)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3 flex items-center gap-2">
          <Award size={14} className="text-[var(--dpf-accent)]" />
          Recent graduations
        </h2>
        {graduations.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">
            No graduations in the window. (Calibrator + Autonomy Governor land in Phase 1; until then,
            no triple can graduate.)
          </p>
        ) : (
          <ul className="space-y-1 text-xs text-[var(--dpf-text)]">
            {graduations.map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                <span className="text-[var(--dpf-muted)]">{g.recordedAt.toISOString()}</span>
                <span className="font-semibold">{g.capabilityName}</span>
                <span className="text-[var(--dpf-muted)]">×</span>
                <span>{g.archetypeContext ?? "any-archetype"}</span>
                <span className="text-[var(--dpf-muted)]">×</span>
                <span>{g.agentIdForTriple}</span>
                <span className="text-[var(--dpf-muted)] mx-1">
                  Ring {g.innerRing}→{g.outerRing}
                </span>
                <span>
                  {g.fromAutonomy} <ArrowRight size={10} className="inline mx-1" /> {g.toAutonomy}
                </span>
                {g.sampleSize != null && <span className="text-[var(--dpf-muted)]">(n={g.sampleSize})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent events band — drill-down evidence ------------------------- */}
      <section
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-1)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">Recent transmissions</h2>
        {recentRows.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">
            No GearInterface records in the window. Trigger a Build Studio phase completion to produce
            the first Ring 1→2 emit, or expand the window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[var(--dpf-muted)] text-left">
                <tr>
                  <th className="font-medium pb-1">When</th>
                  <th className="font-medium pb-1">Ring</th>
                  <th className="font-medium pb-1">Capability</th>
                  <th className="font-medium pb-1">Source</th>
                  <th className="font-medium pb-1">Actor</th>
                  <th className="font-medium pb-1 text-right">Torque</th>
                  <th className="font-medium pb-1">Outcome</th>
                  <th className="font-medium pb-1">Grader</th>
                </tr>
              </thead>
              <tbody className="text-[var(--dpf-text)]">
                {recentRows.map((row) => (
                  <tr key={row.id} className="border-t" style={{ borderColor: "var(--dpf-border)" }}>
                    <td className="py-1.5 text-[var(--dpf-muted)] whitespace-nowrap">
                      {row.recordedAt.toISOString().slice(11, 19)}
                    </td>
                    <td className="py-1.5">
                      {row.innerRing != null && row.outerRing != null
                        ? `${row.innerRing}→${row.outerRing}`
                        : row.transmissionDirection}
                    </td>
                    <td className="py-1.5 truncate max-w-[180px]">{row.capabilityName}</td>
                    <td className="py-1.5 text-[var(--dpf-muted)] truncate max-w-[180px]" title={row.shaftSourceId}>
                      {row.shaftSourceType}
                    </td>
                    <td className="py-1.5 truncate max-w-[120px]">{row.actorId}</td>
                    <td className="py-1.5 text-right font-semibold" style={{ color: torqueColor(row.torqueTechnical) }}>
                      {formatTorque(row.torqueTechnical)}
                    </td>
                    <td className="py-1.5">
                      {row.slipDetected ? (
                        <span className="text-[#f87171]">slip{row.slipReason ? `: ${row.slipReason}` : ""}</span>
                      ) : (
                        row.outcomeType
                      )}
                    </td>
                    <td className="py-1.5 text-[var(--dpf-muted)]">{row.graderType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[10px] text-[var(--dpf-muted)] italic">
        Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md · BI-85CB31F0 · Phase 0 (Ring 1→2 pilot)
      </p>
    </div>
  );
}
