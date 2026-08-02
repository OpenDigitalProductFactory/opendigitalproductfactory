"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, ShieldCheck, X } from "lucide-react";
import { LocalTime } from "@/components/ui/LocalTime";
import {
  DataTable,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";
import type { AiRoutingSourceStatus } from "@/lib/ea/ai-routing-architecture-registry";
import type {
  RoutingConformanceFinding,
  RoutingEvidenceConformanceProjection,
} from "@/lib/ai-operations-map/routing-evidence-conformance";
import {
  buildRoutingComparisonViewModel,
  type RoutingArchitectureMode,
  type RoutingComparisonStage,
  type RoutingComparisonStation,
} from "@/lib/ai-operations-map/routing-comparison-view-model";

type Props = {
  evidence: RoutingEvidenceConformanceProjection;
  initialMode?: RoutingArchitectureMode;
  initialFocusStageId?: string | null;
};

const MODES: ReadonlyArray<{
  id: RoutingArchitectureMode;
  label: string;
  help: string;
}> = [
  { id: "designed", label: "Designed", help: "How routing is supposed to work" },
  { id: "observed", label: "Observed", help: "What privacy-safe evidence recorded" },
  { id: "compare", label: "Compare", help: "Design and evidence in one stable map" },
];

const STAGE_COLUMNS: Column<RoutingComparisonStage>[] = [
  {
    key: "step",
    header: "Owner step",
    cell: (stage) => (
      <div>
        <p className="font-medium text-[var(--dpf-text)]">{stage.ownerLabel}</p>
        <p className="mt-0.5 text-dpf-caption text-[var(--dpf-muted)]">{stage.technicalName}</p>
      </div>
    ),
  },
  {
    key: "status",
    header: "Design",
    cell: (stage) => (
      <StatusBadge
        intent={
          stage.source.status === "implemented"
            ? "success"
            : stage.source.status === "partial"
              ? "warning"
              : "neutral"
        }
        label={stage.source.status}
      />
    ),
  },
  {
    key: "source",
    header: "Source & version",
    cell: (stage) => (
      <div className="max-w-[26rem]">
        <p className="break-all font-mono text-dpf-caption text-[var(--dpf-text)]">
          {stage.source.path}
          {stage.source.symbol ? `#${stage.source.symbol}` : ""}
        </p>
        <p className="mt-0.5 font-mono text-dpf-caption text-[var(--dpf-muted)]">
          {stage.source.version}
        </p>
      </div>
    ),
  },
];

export function RoutingArchitectureOverview({
  evidence,
  initialMode = "compare",
  initialFocusStageId = null,
}: Props) {
  const [mode, setMode] = useState<RoutingArchitectureMode>(initialMode);
  const view = useMemo(
    () => buildRoutingComparisonViewModel(evidence, { mode, focusStageId: initialFocusStageId }),
    [evidence, initialFocusStageId, mode],
  );
  const [selectedStationId, setSelectedStationId] = useState<string | null>(
    view.focusedStationId,
  );
  const [selectedStageId, setSelectedStageId] = useState<string | null>(
    initialFocusStageId,
  );
  const selectedStation =
    view.stations.find((station) => station.id === selectedStationId) ?? null;

  useEffect(() => {
    if (!selectedStation) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedStationId(null);
      setSelectedStageId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedStation]);

  const selectMode = (nextMode: RoutingArchitectureMode) => {
    setMode(nextMode);
    replaceMapUrl(nextMode, selectedStageId);
  };
  const selectStation = (station: RoutingComparisonStation) => {
    const focusStageId = station.stages[0]?.id ?? null;
    setSelectedStationId(station.id);
    setSelectedStageId(focusStageId);
    replaceMapUrl(mode, focusStageId);
  };
  const focusStage = (stageId: string) => {
    setSelectedStageId(stageId);
    replaceMapUrl(mode, stageId);
  };
  const closeInspector = () => {
    setSelectedStationId(null);
    setSelectedStageId(null);
    replaceMapUrl(mode, null);
  };

  return (
    <section
      aria-labelledby="routing-architecture-title"
      className="overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-sm"
    >
      <div className="border-b border-[var(--dpf-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--dpf-accent)_12%,var(--dpf-surface-1)),var(--dpf-surface-1)_55%)] px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-dpf-caption font-semibold uppercase tracking-[0.16em] text-[var(--dpf-accent)]">
              Governed AI routing
            </p>
            <h2 id="routing-architecture-title" className="mt-1 text-xl font-semibold text-[var(--dpf-text)]">
              How an AI request moves — and what actually happened
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--dpf-muted)]">
              Follow five owner-readable stations. The shape stays fixed while you switch between the governed design,
              privacy-safe operational evidence, and their differences.
            </p>
          </div>

          <div
            role="group"
            aria-label="Routing architecture view"
            className="inline-flex w-fit rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-1"
          >
            {MODES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={mode === option.id}
                title={option.help}
                onClick={() => selectMode(option.id)}
                className={`min-h-11 rounded-md px-3 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] ${
                  mode === option.id
                    ? "bg-[var(--dpf-accent)] text-[var(--dpf-on-accent,var(--dpf-surface-1))] shadow-sm"
                    : "text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--dpf-muted)]">
          <span className="font-semibold text-[var(--dpf-text)]">{view.summary.title}</span>
          {view.showObserved ? (
            <>
              <span>{view.summary.decisionVolume} routing decisions</span>
              {/* BI-3006D674: screenReceipt is hard-coded null pending the
                  sensitive-routing dependency, so this rate is structurally 0.
                  "0% screened" reads as a screening failure; name the missing
                  instrumentation instead. */}
              <span>
                {view.summary.screenCoverageInstrumented
                  ? `${formatPercent(view.summary.screenCoverageRate)} screened`
                  : "screening not instrumented"}
              </span>
              <span>{formatPercent(view.summary.designBindingRate)} design-bound</span>
              <span className={view.summary.findingCount > 0 ? "text-[var(--dpf-warning)]" : "text-[var(--dpf-success)]"}>
                {view.summary.findingCount} conformance {view.summary.findingCount === 1 ? "finding" : "findings"}
              </span>
              <span className="inline-flex items-center gap-1">
                Newest evidence <LocalTime value={view.latestEvidenceAt} mode="datetime" />
              </span>
            </>
          ) : (
            <span>Design revision {view.designRevision}</span>
          )}
        </div>
      </div>

      <div className="px-4 py-5 md:px-5">
        <div className="relative">
          <div
            aria-hidden
            className="absolute left-[8%] right-[8%] top-[2.35rem] hidden h-0.5 bg-[var(--dpf-border)] md:block"
          />
          <ol className="relative grid grid-cols-1 gap-3 md:grid-cols-5">
            {view.stations.map((station, index) => (
              <li key={station.id} className="relative">
                <button
                  type="button"
                  data-testid="owner-routing-station"
                  aria-label={`${station.label}: ${station.description}`}
                  onClick={() => selectStation(station)}
                  className={`group min-h-11 w-full rounded-lg border p-3 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] ${
                    selectedStationId === station.id
                      ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] shadow-sm"
                      : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] hover:-translate-y-0.5 hover:border-[var(--dpf-accent)] hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] text-xs font-bold text-[var(--dpf-accent)]">
                      {station.sequence}
                    </span>
                    {index < view.stations.length - 1 ? (
                      <ArrowRight aria-hidden className="h-4 w-4 text-[var(--dpf-muted)] md:hidden" />
                    ) : null}
                    {view.showObserved && station.findings.length > 0 ? (
                      <StatusBadge
                        intent={stationBadgeIntent(station.findings)}
                        label={stationBadgeLabel(station.findings)}
                      />
                    ) : null}
                  </div>
                  <h2 className="mt-2 text-sm font-semibold leading-5 text-[var(--dpf-text)]">{station.label}</h2>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--dpf-muted)]">{station.description}</p>

                  <div className="mt-3 space-y-1 border-t border-[var(--dpf-border)] pt-2 text-dpf-caption">
                    {view.showDesigned ? (
                      <p className="flex items-center justify-between gap-2">
                        <span className="text-[var(--dpf-muted)]">Build</span>
                        <span className="font-medium text-[var(--dpf-text)]">
                          {describeDesignMaturity(station.designStatusCounts)}
                        </span>
                      </p>
                    ) : null}
                    {view.showObserved ? (
                      <p className="flex items-center justify-between gap-2">
                        <span className="text-[var(--dpf-muted)]">Observed</span>
                        <span className="font-medium text-[var(--dpf-text)]">
                          {station.metrics[0]?.value ?? "Evidence below"}
                        </span>
                      </p>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2 text-xs">
          <p className="inline-flex items-center gap-2 text-[var(--dpf-muted)]">
            <ShieldCheck aria-hidden className="h-4 w-4 text-[var(--dpf-success)]" />
            Safe inputs only: counts, timings, route identifiers, design versions, and conformance findings. No prompts or detected values.
          </p>
          <Link href="/ea" className="font-semibold text-[var(--dpf-accent)] hover:underline">
            View governed architecture
          </Link>
        </div>
      </div>

      {selectedStation ? (
        <StationInspector
          station={selectedStation}
          mode={mode}
          designRevision={view.designRevision}
          evidenceWindow={view.evidenceWindow}
          instrumentedSince={view.instrumentedSince}
          focusedStageId={selectedStageId}
          onFocusStage={focusStage}
          onClose={closeInspector}
        />
      ) : null}
    </section>
  );
}

/**
 * Badge intent faithful to the DECLARED severity — BI-C8BC9DD1.
 *
 * This previously read `severity === "error" ? "danger" : "warning"`, which
 * collapsed a three-value contract into two and rendered every `info` finding
 * as an operational warning. The worst case was real: station 1 carried exactly
 * one finding, `ai-routing-design-unproven`, declared `info` and counting
 * traffic that predates the evidence ledger — and it showed an amber warning.
 *
 * A station whose findings are ALL `none-historical` gets `neutral`. Nothing
 * can be done about that traffic, so presenting it with alert chrome states
 * something false about the install.
 */
export function stationBadgeIntent(
  findings: readonly RoutingConformanceFinding[],
): "danger" | "warning" | "info" | "neutral" {
  if (findings.some((finding) => finding.severity === "error")) return "danger";
  if (findings.every((finding) => finding.ownerAction === "none-historical")) return "neutral";
  if (findings.some((finding) => finding.severity === "warn")) return "warning";
  return "info";
}

/**
 * Badge label. Historic-only stations are counted as history, not as issues —
 * and the noun agrees with the number, which the hardcoded "issue" did not.
 */
export function stationBadgeLabel(findings: readonly RoutingConformanceFinding[]): string {
  const total = findings.reduce((sum, finding) => sum + finding.count, 0);
  if (findings.every((finding) => finding.ownerAction === "none-historical")) {
    return `${total} historic`;
  }
  return `${total} ${total === 1 ? "issue" : "issues"}`;
}

/**
 * Describe a station's PLATFORM BUILD maturity — BI-3006D674.
 *
 * This replaced `${implemented}/${stages.length} implemented`, which counted
 * only the `implemented` status and therefore rendered `partial` as absent.
 * Station 2 holds three partial stages backed by working code and reported
 * "0/6 implemented" — false about the codebase, and read by an owner as their
 * own install being broken when their routing was in fact healthy.
 *
 * Stated in words rather than as a ratio precisely so it cannot be mistaken for
 * a score of the owner's install. Empty segments are omitted, so a station never
 * reports a zero for a status it simply does not have.
 */
export function describeDesignMaturity(counts: Record<AiRoutingSourceStatus, number>): string {
  const segments: string[] = [];
  if (counts.implemented > 0) segments.push(`${counts.implemented} built`);
  if (counts.partial > 0) segments.push(`${counts.partial} partial`);
  if (counts.proposed > 0) segments.push(`${counts.proposed} planned`);
  return segments.length > 0 ? segments.join(" · ") : "none";
}

/**
 * Findings panel — BI-C8BC9DD1.
 *
 * Two behaviours the previous inline markup got wrong:
 *  - chrome was hardcoded amber, so a panel of purely historic counts read as a
 *    warning about the install;
 *  - findings showed `message` only, with no answer to "what do I do about
 *    this?" — the gap that left an owner's coworker unable to help.
 *
 * Kept as its own named component rather than an inline IIFE, and written
 * without arrow callbacks in the body: the prose-lint copy extractor scans for
 * text sitting between JSX angle brackets, and an arrow token opens a match
 * that runs on into the markup, so callback code gets counted as UI copy.
 * A named component with plain loops keeps the measurement honest.
 */
function StationFindingsPanel({ findings }: { findings: RoutingConformanceFinding[] }) {
  let historicOnly = true;
  for (const finding of findings) {
    if (finding.ownerAction !== "none-historical") historicOnly = false;
  }
  const accent = historicOnly ? "var(--dpf-border)" : "var(--dpf-warning)";
  return (
    <section
      className="rounded-lg border p-3"
      style={{
        borderColor: accent,
        background: historicOnly
          ? "var(--dpf-surface-2)"
          : `color-mix(in srgb, ${accent} 8%, var(--dpf-surface-1))`,
      }}
    >
      <h3 className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--dpf-text)]">
        <CircleAlert
          aria-hidden
          className="h-4 w-4"
          style={{ color: historicOnly ? "var(--dpf-muted)" : accent }}
        />
        {historicOnly ? "Historic evidence" : "Design/evidence differences"}
      </h3>
      <ul className="mt-2 space-y-3">
        {findings.map((finding) => (
          <li key={finding.issueKey} className="text-xs leading-5 text-[var(--dpf-muted)]">
            <p>
              <span className="font-semibold text-[var(--dpf-text)]">{finding.count}×</span>{" "}
              {finding.message}
            </p>
            <p className="mt-1 text-[var(--dpf-text)]">{finding.nextAction}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StationInspector({
  station,
  mode,
  designRevision,
  evidenceWindow,
  instrumentedSince,
  focusedStageId,
  onFocusStage,
  onClose,
}: {
  station: RoutingComparisonStation;
  mode: RoutingArchitectureMode;
  designRevision: string;
  evidenceWindow: { start: string; end: string };
  instrumentedSince: string | null;
  focusedStageId: string | null;
  onFocusStage: (stageId: string) => void;
  onClose: () => void;
}) {
  const focusedStage =
    station.stages.find((stage) => stage.id === focusedStageId) ?? station.stages[0] ?? null;
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`${station.label} details`}
      className="border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--dpf-border)] px-4 py-3 md:px-5">
        <div>
          <p className="text-dpf-caption font-semibold uppercase tracking-[0.14em] text-[var(--dpf-accent)]">
            Station {station.sequence} · {mode}
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{station.label}</h2>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{station.description}</p>
        </div>
        <button
          type="button"
          aria-label="Close station details"
          onClick={onClose}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            {station.stages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                aria-pressed={focusedStage?.id === stage.id}
                onClick={() => onFocusStage(stage.id)}
                className={`min-h-11 rounded-md border px-3 py-2 text-left text-xs focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] ${
                  focusedStage?.id === stage.id
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                }`}
              >
                {stage.ownerLabel}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <DataTable
              columns={STAGE_COLUMNS}
              rows={station.stages}
              getRowKey={(stage) => stage.id}
              dense
            />
          </div>
        </div>

        <div className="space-y-3">
          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
              Observed at this station
            </h3>
            {station.metrics.length > 0 ? (
              <dl className="mt-2 space-y-2">
                {station.metrics.map((metric) => (
                  <div key={metric.id} title={metric.help} className="flex items-start justify-between gap-3">
                    <dt className="text-xs text-[var(--dpf-muted)]">{metric.label}</dt>
                    <dd className="text-right text-xs font-semibold text-[var(--dpf-text)]">{metric.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-xs leading-5 text-[var(--dpf-muted)]">
                The current evidence contract begins at the routing decision; request content is intentionally excluded.
              </p>
            )}
          </section>

          {station.findings.length > 0 ? (
            <StationFindingsPanel findings={station.findings} />
          ) : null}

          <section className="rounded-lg border border-[var(--dpf-border)] p-3 text-xs text-[var(--dpf-muted)]">
            <p><span className="font-semibold text-[var(--dpf-text)]">Safe inputs only.</span> No prompt, credential, detected value, or token map is projected here.</p>
            <p className="mt-2">Design revision <span className="font-mono text-[var(--dpf-text)]">{designRevision}</span></p>
            <p className="mt-1">
              Evidence window <LocalTime value={evidenceWindow.start} /> — <LocalTime value={evidenceWindow.end} />
            </p>
            {instrumentedSince ? (
              <p className="mt-1">
                Ledger begins <LocalTime value={instrumentedSince} />
              </p>
            ) : null}
            {focusedStage ? (
              <Link
                href={`/ea?focus=${encodeURIComponent(focusedStage.id)}`}
                className="mt-3 inline-flex font-semibold text-[var(--dpf-accent)] hover:underline"
              >
                Open in Enterprise Architecture
              </Link>
            ) : null}
          </section>
        </div>
      </div>
    </aside>
  );
}

function replaceMapUrl(mode: RoutingArchitectureMode, focusStageId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("mode", mode);
  if (focusStageId) url.searchParams.set("focus", focusStageId);
  else url.searchParams.delete("focus");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}
