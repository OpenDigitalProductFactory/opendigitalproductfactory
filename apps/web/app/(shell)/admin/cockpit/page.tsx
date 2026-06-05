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
  getInterfaceTorqueReadings,
  getSlipByReason,
  getTripleWearReadings,
  getRecentGraduations,
  listRecentGearInterfaceRows,
} from "@/lib/gear-interface";
import {
  findReadings,
  formatCost,
  formatPercent,
  formatTorque,
  summarizeInterface,
  torqueColor,
} from "@/lib/cockpit/cockpit-formatting";
import {
  getCockpitInterfaceLabel,
  getCockpitTerminology,
  resolveCockpitRowLabels,
} from "@/lib/cockpit/install-terminology";
import { GraduationVetoButton } from "@/components/cockpit/GraduationVetoButton";
import { LocalTime } from "@/components/ui/LocalTime";
import { CockpitEventsTable, type CockpitEventRow } from "./CockpitEventsTable";

// All four ring interfaces. Phase 0 only emits at 1→2; the others render as
// "no data" lanes so the operator sees the gear train honestly, not hidden.
const ALL_INTERFACES: Array<{ innerRing: number; outerRing: number }> = [
  { innerRing: 1, outerRing: 2 },
  { innerRing: 2, outerRing: 3 },
  { innerRing: 3, outerRing: 4 },
  { innerRing: 4, outerRing: 5 },
];

function parseRingFilter(value: string | undefined): { innerRing: number; outerRing: number } | null {
  const match = value?.match(/^([1-4])-([2-5])$/);
  if (!match) return null;
  const innerRing = Number(match[1]);
  const outerRing = Number(match[2]);
  return outerRing === innerRing + 1 ? { innerRing, outerRing } : null;
}

function parseDirectionFilter(value: string | undefined): "outward" | "inward" | "lateral" | undefined {
  return value === "outward" || value === "inward" || value === "lateral" ? value : undefined;
}

export default async function CockpitPage({
  searchParams,
}: {
  searchParams?: Promise<{ ring?: string; days?: string; dir?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const days = Math.max(1, Math.min(90, Number(params.days ?? "7") || 7));
  const activeRing = parseRingFilter(params.ring);
  const activeDirection = parseDirectionFilter(params.dir);
  const recentFilter = {
    ...(activeRing ?? {}),
    ...(activeDirection ? { transmissionDirection: activeDirection } : {}),
  };
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  const window = { start, end: now };

  // Aggregate fetches in parallel — every Cockpit panel reads from the same window
  const [interfaceReadings, slipByReason, wear, graduations, recentRows, terminology] = await Promise.all([
    getInterfaceTorqueReadings(window),
    getSlipByReason(window),
    getTripleWearReadings(window, { minSampleSize: 1 }),
    getRecentGraduations(window, { limit: 10 }),
    listRecentGearInterfaceRows(window, recentFilter, { limit: 50 }),
    getCockpitTerminology(),
  ]);

  const totalRows = interfaceReadings.reduce((acc, r) => acc + r.totalRecords, 0);
  const activeInterfaceLabel = activeRing
    ? getCockpitInterfaceLabel(activeRing.innerRing, activeRing.outerRing, terminology)
    : null;

  // Pre-resolve install-terminology labels server-side into flat, serializable
  // rows for the client DataTable (the recent-transmissions log).
  const eventRows: CockpitEventRow[] = recentRows.map((row) => {
    const labels = resolveCockpitRowLabels(
      {
        innerRing: row.innerRing,
        outerRing: row.outerRing,
        transmissionDirection: row.transmissionDirection,
        agentIdForTriple: row.actorId,
        actorId: row.actorId,
        capabilityName: row.capabilityName,
        archetypeContext: row.archetypeContext,
        shaftSourceType: row.shaftSourceType,
        outcomeType: row.outcomeType,
        slipDetected: row.slipDetected,
        slipReason: row.slipReason,
      },
      terminology,
    );
    return {
      id: row.id,
      recordedAtISO: new Date(row.recordedAt).toISOString(),
      interfaceLabel: labels.interfaceLabel,
      capabilityLabel: labels.capabilityLabel,
      capabilityName: row.capabilityName,
      sourceLabel: labels.sourceLabel,
      shaftSourceId: row.shaftSourceId,
      actorLabel: labels.actorLabel,
      actorId: row.actorId,
      torqueTechnical: row.torqueTechnical,
      outcomeLabel: labels.outcomeLabel,
      slipDetected: row.slipDetected,
      graderType: row.graderType,
    };
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header band ----------------------------------------------------- */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)] flex items-center gap-2">
            <GitMerge size={18} className="text-[var(--dpf-accent)]" />
            {terminology.mode === "install-aware" ? `${terminology.installName} Cockpit` : "Reduction Gear Cockpit"}
          </h1>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">
            {terminology.mode === "install-aware"
              ? `Operator diagnostic view for ${terminology.portalLabel} across ${terminology.verticalLabel} work — torque, slip, wear, cost, and graduations remain tied to GearInterface evidence.`
              : "Operator diagnostic view — torque, slip, wear, cost, graduations across the agentic gear train."}
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

      {terminology.banner && (
        <section
          className="rounded border p-3 flex items-start justify-between gap-3"
          style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-1)" }}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="text-[var(--dpf-muted)] mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-[var(--dpf-text)]">{terminology.banner.message}</p>
              <p className="text-[11px] text-[var(--dpf-muted)] mt-0.5">
                Missing context: {terminology.missingContext.join(", ")}.
              </p>
            </div>
          </div>
          <Link href={terminology.banner.href} className="text-xs font-semibold text-[var(--dpf-accent)] hover:underline">
            {terminology.banner.cta}
          </Link>
        </section>
      )}

      {/* Ring overview band ----------------------------------------------- */}
      <section
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-1)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">
          {terminology.mode === "install-aware" ? `${terminology.portalLabel} gear interfaces` : "Gear interfaces"}
        </h2>
        <div className="space-y-2">
          {ALL_INTERFACES.map(({ innerRing, outerRing }) => {
            const label = getCockpitInterfaceLabel(innerRing, outerRing, terminology);
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
            {terminology.mode === "install-aware"
              ? `${terminology.verticalLabel} triple wear`
              : "Triple wear (lowest torque first)"}
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
                {wear.slice(0, 10).map((row, i) => {
                  const labels = resolveCockpitRowLabels(
                    {
                      innerRing: null,
                      outerRing: null,
                      transmissionDirection: "outward",
                      agentIdForTriple: row.agentIdForTriple,
                      actorId: row.agentIdForTriple,
                      capabilityName: row.capabilityName,
                      archetypeContext: row.archetypeContext,
                      shaftSourceType: "gear-interface",
                      outcomeType: "transmission",
                      slipDetected: false,
                      slipReason: null,
                    },
                    terminology,
                  );
                  return (
                    <tr
                      key={`${row.agentIdForTriple}-${row.capabilityName}-${row.archetypeContext ?? "null"}-${i}`}
                      className="border-t"
                      style={{ borderColor: "var(--dpf-border)" }}
                    >
                      <td className="py-1.5 truncate max-w-[140px]" title={row.agentIdForTriple}>
                        {labels.agentLabel}
                      </td>
                      <td className="py-1.5 truncate max-w-[180px]" title={row.capabilityName}>
                        {labels.capabilityLabel}
                      </td>
                      <td className="py-1.5 text-[var(--dpf-muted)]">{labels.archetypeLabel}</td>
                      <td className="py-1.5 text-right">{row.sampleSize}</td>
                      <td className="py-1.5 text-right font-semibold" style={{ color: torqueColor(row.meanTorqueTechnical) }}>
                        {formatTorque(row.meanTorqueTechnical)}
                      </td>
                    </tr>
                  );
                })}
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
            {graduations.map((g) => {
              const labels = resolveCockpitRowLabels(
                {
                  innerRing: g.innerRing,
                  outerRing: g.outerRing,
                  transmissionDirection: "outward",
                  agentIdForTriple: g.agentIdForTriple,
                  actorId: g.agentIdForTriple,
                  capabilityName: g.capabilityName,
                  archetypeContext: g.archetypeContext,
                  shaftSourceType: "decision-interaction",
                  outcomeType: "graduation",
                  slipDetected: false,
                  slipReason: null,
                },
                terminology,
              );
              return (
                <li key={g.id} className="flex items-center gap-2 flex-wrap">
                  <LocalTime value={g.recordedAt} className="text-[var(--dpf-muted)]" />
                  <span className="font-semibold">{labels.capabilityLabel}</span>
                  <span className="text-[var(--dpf-muted)]">for</span>
                  <span>{labels.agentLabel}</span>
                  <span className="text-[var(--dpf-muted)] mx-1">{labels.interfaceLabel}</span>
                  <span>
                    {g.fromAutonomy} <ArrowRight size={10} className="inline mx-1" /> {g.toAutonomy}
                  </span>
                  {g.sampleSize != null && <span className="text-[var(--dpf-muted)]">(n={g.sampleSize})</span>}
                  <span className="ml-auto">
                    <GraduationVetoButton graduationRowId={g.id} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent events band — drill-down evidence ------------------------- */}
      <section
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", background: "var(--dpf-surface-1)" }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
              {activeInterfaceLabel ? "Filtered transmissions" : "Recent transmissions"}
            </h2>
            {activeInterfaceLabel && (
              <p className="text-[11px] text-[var(--dpf-muted)] mt-0.5">
                {activeInterfaceLabel}
                {activeDirection ? ` - ${activeDirection}` : ""}
              </p>
            )}
          </div>
          {activeInterfaceLabel && (
            <Link href={`?days=${days}`} className="text-xs font-semibold text-[var(--dpf-accent)] hover:underline">
              Clear filter
            </Link>
          )}
        </div>
        {recentRows.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">
            {activeInterfaceLabel
              ? "No GearInterface records match this filtered drill-down. The source evidence state is unknown for this filter."
              : "No GearInterface records in the window. Trigger a Build Studio phase completion to produce the first Ring 1→2 emit, or expand the window."}
          </p>
        ) : (
          <CockpitEventsTable rows={eventRows} />
        )}
      </section>

      <p className="text-[10px] text-[var(--dpf-muted)] italic">
        Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md · BI-85CB31F0 · Phase 0 (Ring 1→2 pilot)
      </p>
    </div>
  );
}
