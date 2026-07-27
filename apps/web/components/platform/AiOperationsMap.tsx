"use client";

import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RotateCcw, type LucideIcon, ZoomIn, ZoomOut } from "lucide-react";
import type {
  OperationsMapProjection,
  OperationsMapProjectionSource,
  OperationsMapQuickViewId,
  OperationsMapRoutingMarkerType,
  OperationsMapRoutingProviderType,
  OperationsMapRoutingRouteState,
  OperationsMapRoutingTopology,
  OperationsMapSeverity,
  OperationsMapTemplate,
  StationedOperationsMapAgent,
} from "@/lib/ai-operations-map/types";
import type { RoutingEvidenceConformanceProjection } from "@/lib/ai-operations-map/routing-evidence-conformance";
import type { RoutingArchitectureMode } from "@/lib/ai-operations-map/routing-comparison-view-model";
import {
  buildStationProjectionTiles,
  filterOperationsMapProjections,
  getOperationsMapQuickViewFilters,
  OPERATIONS_MAP_QUICK_VIEWS,
} from "@/lib/ai-operations-map/project-events";
import {
  clearOperationsMapViewPreference,
  loadOperationsMapViewPreference,
  saveOperationsMapViewPreference,
  getDefaultOperationsMapDimension,
  loadOperationsMapDimension,
  saveOperationsMapDimension,
  type OperationsMapDimension,
  type OperationsMapStoredQuickViewId,
} from "./ai-operations-map-prefs";
import { StalledTaskRecoveryActions } from "./StalledTaskRecoveryActions";
import { A2aInteractionsPanel } from "./A2aInteractionsPanel";
import { DeliberationLensPanel } from "./DeliberationLensPanel";
import { OperationsTopologyCanvas } from "./OperationsTopologyCanvas";
import { ActivityRoutingWorkbench } from "./ActivityRoutingWorkbench";
import { RoutingArchitectureOverview } from "./RoutingArchitectureOverview";
import {
  applyRoutingControlFilters,
  applyA2aControlFilters,
  providerMatchesTypeFilter,
  markerMatchesRouteFilter,
  type RoutingRouteFilter,
  type RoutingProviderTypeFilter,
  type RoutingControlCriteria,
  type A2aControlCriteria,
} from "./operations-control-filters";

type SelectedItem =
  | { kind: "station"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "projection"; id: string };

export type OperationsMapEvidenceRange = {
  earliest: string | null;
  latest: string | null;
};

type Props = {
  template: OperationsMapTemplate;
  agents: StationedOperationsMapAgent[];
  projections: OperationsMapProjection[];
  routingTopology: OperationsMapRoutingTopology;
  routingEvidence: RoutingEvidenceConformanceProjection;
  recentWindowLabel: string;
  initialArchitectureMode?: RoutingArchitectureMode;
  initialFocusStageId?: string | null;
  /**
   * Global evidence bounds (window-independent). When provided, the replay
   * timeline anchors its base range to these instead of only the loaded
   * events, so a windowed refetch can't shrink the scrubber, and a
   * "data begins" boundary marker renders at the earliest timestamp.
   */
  evidenceRange?: OperationsMapEvidenceRange | null;
  /**
   * Publishes the provider panel's visible replay window upward (live-shell
   * refresh loop, BI-44D3203D) alongside the existing internal A2A share.
   */
  onReplayWindowChange?: (window: { time: number; start: number; end: number }) => void;
};

const SEVERITY_CLASS: Record<OperationsMapProjection["severity"], string> = {
  normal: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
  attention: "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]",
  warning: "border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]",
  critical: "border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]",
};

const SOURCE_LABEL: Record<OperationsMapProjection["source"], string> = {
  "task-run": "Task run",
  "tool-execution": "Tool execution",
  "tool-receipt": "Receipt",
  "evidence-backlog": "Backlog evidence",
  "evidence-external": "External evidence",
};

const SOURCE_OPTIONS: OperationsMapProjectionSource[] = [
  "task-run",
  "tool-execution",
  "tool-receipt",
  "evidence-backlog",
  "evidence-external",
];

const SEVERITY_OPTIONS: OperationsMapSeverity[] = ["normal", "attention", "warning", "critical"];
// BI-62c4197e — how many projection tiles a station band shows inline before an
// overflow "+N more" control routes the rest to the station inspector list.
const STATION_TILE_VISIBLE_LIMIT = 4;
const DEFAULT_QUICK_VIEW_ID: OperationsMapQuickViewId = "all";
const DEFAULT_QUICK_VIEW_FILTERS = getOperationsMapQuickViewFilters(DEFAULT_QUICK_VIEW_ID);

const ROUTE_STATE_LABEL: Record<OperationsMapRoutingRouteState, string> = {
  active: "Selected active route",
  secondary: "Normal secondary traffic",
  failover: "Failover or degraded route",
  scheduled: "Scheduled or forecast route",
  historical: "Historical route",
};

type RoutingTopologyRoute = OperationsMapRoutingTopology["routes"][number];
type RoutingTopologyMarker = OperationsMapRoutingTopology["markers"][number];
type RoutingTopologyProvider = OperationsMapRoutingTopology["providers"][number];
type RoutingTimelineRange = { start: number; current: number; end: number };
type RoutingTick = { id: string; label: string; major: boolean; position: number; timestamp: number };
type RoutingSymbolAnchor = { x: number; y: number };
type RoutingSymbolEvent = SyntheticEvent<SVGGElement>;
type ProviderLogoDefinition = { key: string; mark: string; wordmark: string };
type DisplayRoutingRoute = RoutingTopologyRoute & {
  eventCount: number;
  sourceRouteIds: string[];
};

const ROUTE_FILTER_OPTIONS: Array<{ id: RoutingRouteFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "failover", label: "Failover" },
  { id: "scheduled", label: "Scheduled" },
];

const PROVIDER_TYPE_FILTER_OPTIONS: Array<{ id: RoutingProviderTypeFilter; label: string }> = [
  { id: "llm", label: "LLM providers" },
  { id: "mcp", label: "MCP servers" },
  { id: "all", label: "All providers" },
];

const ROUTING_ZOOM_LEVELS = [0.8, 1, 1.25, 1.5] as const;
const DEFAULT_ROUTING_ZOOM_INDEX = 1;
const ROUTING_TIMELINE_ZOOM_LEVELS = [1, 2, 4, 8, 16] as const;
const DEFAULT_ROUTING_TIMELINE_ZOOM_INDEX = 0;
const ROUTING_ROUTE_STATES: OperationsMapRoutingRouteState[] = ["active", "secondary", "failover", "scheduled", "historical"];
const ROUTING_LAYOUT = {
  width: 1080,
  height: 560,
  panel: { x: 18, y: 18, width: 1044, height: 524 },
  coworkerLaneX: 210,
  providerLaneX: 842,
  coworkerNodeX: 128,
  providerNodeX: 852,
  providerSymbolX: 704,
  routerAuditX: 546,
  routerAuditWidth: 132,
  startY: 96,
  endY: 470,
};
const ROUTING_SYMBOL_LEGEND: Array<{
  type: OperationsMapRoutingMarkerType;
  title: string;
  shortLabel: string;
  description: string;
}> = [
  {
    type: "decision",
    title: "Route decision",
    shortLabel: "Decision",
    description: "Router selected, rejected, or reranked a provider.",
  },
  {
    type: "quota",
    title: "Limit / quota",
    shortLabel: "Quota",
    description: "Hourly cap, spend ceiling, subscription burn, or use-it-or-lose-it pressure.",
  },
  {
    type: "error",
    title: "Error / outage",
    shortLabel: "Error",
    description: "Provider error, auth failure, unavailable model, or tool/runtime failure.",
  },
  {
    type: "failover",
    title: "Failover path",
    shortLabel: "Failover",
    description: "Traffic moved to a recovery provider after another route degraded or failed.",
  },
  {
    type: "scheduled",
    title: "Scheduled future",
    shortLabel: "Scheduled",
    description: "Timed coworker task or calendar event that invokes work before provider routing begins.",
  },
  {
    type: "governance",
    title: "Governance gate",
    shortLabel: "Governance",
    description: "Sensitivity, local-only route, tool grant, or approval boundary.",
  },
];
const PROVIDER_LOGO_MATCHERS: Array<{ match: RegExp; logo: ProviderLogoDefinition }> = [
  { match: /browser-use|browser automation/, logo: { key: "browser-use", mark: "BU", wordmark: "Browser" } },
  { match: /filesystem|file system/, logo: { key: "filesystem", mark: "FS", wordmark: "Files" } },
  { match: /github/, logo: { key: "github", mark: "GH", wordmark: "GitHub" } },
  { match: /postgres|postgresql/, logo: { key: "postgres", mark: "PG", wordmark: "Postgres" } },
  { match: /anthropic|claude/, logo: { key: "anthropic", mark: "C", wordmark: "Claude" } },
  { match: /openai|chatgpt|codex/, logo: { key: "openai", mark: "O", wordmark: "OpenAI" } },
  { match: /gemini|google/, logo: { key: "gemini", mark: "G", wordmark: "Gemini" } },
  { match: /azure/, logo: { key: "azure", mark: "Az", wordmark: "Azure" } },
  { match: /bedrock|aws/, logo: { key: "aws-bedrock", mark: "AWS", wordmark: "Bedrock" } },
  { match: /local|docker|model runner/, logo: { key: "docker-local", mark: "D", wordmark: "Docker" } },
  { match: /ollama/, logo: { key: "ollama", mark: "OL", wordmark: "Ollama" } },
  { match: /xai|grok/, logo: { key: "xai", mark: "x", wordmark: "xAI" } },
  { match: /mistral/, logo: { key: "mistral", mark: "M", wordmark: "Mistral" } },
  { match: /cohere/, logo: { key: "cohere", mark: "Co", wordmark: "Cohere" } },
  { match: /deepseek/, logo: { key: "deepseek", mark: "DS", wordmark: "DeepSeek" } },
  { match: /groq/, logo: { key: "groq", mark: "GQ", wordmark: "Groq" } },
  { match: /together/, logo: { key: "together", mark: "T", wordmark: "Together" } },
  { match: /fireworks/, logo: { key: "fireworks", mark: "FW", wordmark: "Fireworks" } },
  { match: /openrouter/, logo: { key: "openrouter", mark: "OR", wordmark: "Router" } },
  { match: /litellm/, logo: { key: "litellm", mark: "LL", wordmark: "LiteLLM" } },
  { match: /portkey/, logo: { key: "portkey", mark: "P", wordmark: "Portkey" } },
];

export function AiOperationsMap({
  template,
  agents,
  projections,
  routingTopology,
  routingEvidence,
  recentWindowLabel,
  initialArchitectureMode = "compare",
  initialFocusStageId = null,
  evidenceRange,
  onReplayWindowChange,
}: Props) {
  const [selected, setSelected] = useState<SelectedItem>({ kind: "station", id: template.stations[0]?.id ?? "" });
  const [activeQuickViewId, setActiveQuickViewId] = useState<OperationsMapStoredQuickViewId>(
    DEFAULT_QUICK_VIEW_ID,
  );
  const [sourceFilters, setSourceFilters] = useState<OperationsMapProjectionSource[]>(
    DEFAULT_QUICK_VIEW_FILTERS.sources,
  );
  const [severityFilters, setSeverityFilters] = useState<OperationsMapSeverity[]>(
    DEFAULT_QUICK_VIEW_FILTERS.severities,
  );
  const [dimension, setDimension] = useState<OperationsMapDimension>(getDefaultOperationsMapDimension());
  const dimensionHydrated = useRef(false);
  const preferenceHydrated = useRef(false);
  const filteredProjections = useMemo(
    () => filterOperationsMapProjections(projections, { sources: sourceFilters, severities: severityFilters }),
    [projections, sourceFilters, severityFilters],
  );

  useEffect(() => {
    const preference = loadOperationsMapViewPreference();
    setActiveQuickViewId(preference.quickViewId);
    setSourceFilters(preference.filters.sources);
    setSeverityFilters(preference.filters.severities);
    preferenceHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!preferenceHydrated.current) return;
    saveOperationsMapViewPreference({
      quickViewId: activeQuickViewId,
      filters: {
        sources: sourceFilters,
        severities: severityFilters,
      },
    });
  }, [activeQuickViewId, sourceFilters, severityFilters]);

  useEffect(() => {
    setDimension(loadOperationsMapDimension());
    dimensionHydrated.current = true;
  }, []);

  useEffect(() => {
    if (!dimensionHydrated.current) return;
    saveOperationsMapDimension(dimension);
  }, [dimension]);

  const showProvider = dimension === "provider" || dimension === "both";
  const showA2a = dimension === "a2a" || dimension === "both";

  // Shared replay window: the provider routing panel owns the timeline and
  // publishes its playhead here so the A2A interaction band scrubs in step.
  const [sharedReplay, setSharedReplay] = useState<{ time: number; range: RoutingTimelineRange } | null>(null);
  const handleReplayChange = useCallback(
    (time: number, range: RoutingTimelineRange) => {
      setSharedReplay({ time, range });
      onReplayWindowChange?.({ time, start: range.start, end: range.end });
    },
    [onReplayWindowChange],
  );

  const [routingControl, setRoutingControl] = useState<RoutingControlCriteria>({
    routeFilter: "all",
    providerTypeFilter: "llm",
    providerFilter: "all",
  });
  const [a2aControl, setA2aControl] = useState<A2aControlCriteria>({
    types: ["a2a-delegation", "a2a-handoff", "a2a-task-lineage", "a2a-deliberation"],
    states: ["active", "completed", "failed", "blocked"],
    actorId: "all",
    actorRole: "either",
    authority: "all",
  });
  const handleRoutingControlChange = useCallback(
    (criteria: RoutingControlCriteria) => setRoutingControl(criteria),
    [],
  );
  const handleA2aControlChange = useCallback(
    (criteria: A2aControlCriteria) => setA2aControl(criteria),
    [],
  );

  const canvasTopology = useMemo(() => {
    const { routes, providers, markers } = applyRoutingControlFilters(routingTopology, routingControl);
    const a2aEdges = applyA2aControlFilters(routingTopology.a2aEdges, a2aControl);
    return { ...routingTopology, routes, providers, markers, a2aEdges };
  }, [routingTopology, routingControl, a2aControl]);

  const selectedStation = selected.kind === "station"
    ? template.stations.find((station) => station.id === selected.id) ?? null
    : null;
  const selectedAgent = selected.kind === "agent"
    ? agents.find((agent) => agent.agentId === selected.id) ?? null
    : null;
  const selectedProjection = selected.kind === "projection"
    ? filteredProjections.find((projection) => projection.id === selected.id) ?? null
    : null;
  const applyQuickView = (viewId: OperationsMapQuickViewId) => {
    const filters = getOperationsMapQuickViewFilters(viewId);
    setActiveQuickViewId(viewId);
    setSourceFilters(filters.sources);
    setSeverityFilters(filters.severities);
  };
  const resetView = () => {
    clearOperationsMapViewPreference();
    setActiveQuickViewId(DEFAULT_QUICK_VIEW_ID);
    setSourceFilters(getOperationsMapQuickViewFilters(DEFAULT_QUICK_VIEW_ID).sources);
    setSeverityFilters(getOperationsMapQuickViewFilters(DEFAULT_QUICK_VIEW_ID).severities);
  };
  const toggleSourceFilter = (source: OperationsMapProjectionSource) => {
    setActiveQuickViewId("custom");
    setSourceFilters((current) => toggleFilterOption(current, source, SOURCE_OPTIONS));
  };
  const toggleSeverityFilter = (severity: OperationsMapSeverity) => {
    setActiveQuickViewId("custom");
    setSeverityFilters((current) => toggleFilterOption(current, severity, SEVERITY_OPTIONS));
  };

  return (
    <div className="space-y-4">
      <RoutingArchitectureOverview
        evidence={routingEvidence}
        initialMode={initialArchitectureMode}
        initialFocusStageId={initialFocusStageId}
      />

      <section aria-label="Routing map workspace" className="space-y-3">
        <header className="sr-only">
          <p>AI workforce</p>
          <h1>AI Operations Map</h1>
          <p>
            Live coworker routing across providers, failover paths, spend pressure, local LLM lanes, and scheduled coworker invocation windows.
          </p>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Technical topology</h2>
          <DimensionToggle dimension={dimension} onChange={setDimension} />
        </div>

        <section
          data-authoritative-operations-canvas
          aria-label="Unified operations topology"
          className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
        >
          <OperationsTopologyCanvas
            topology={canvasTopology}
            dimension={dimension}
            replayTime={sharedReplay?.time ?? null}
            replayRange={sharedReplay?.range ?? null}
          />
        </section>

        <details
          aria-label="Technical routing diagnostics"
          className="group rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Technical diagnostics</h2>
            <span className="rounded border border-[var(--dpf-border)] px-2 py-1 text-dpf-caption uppercase tracking-[0.14em] text-[var(--dpf-muted)] group-open:hidden">Open</span>
            <span className="hidden rounded border border-[var(--dpf-border)] px-2 py-1 text-dpf-caption uppercase tracking-[0.14em] text-[var(--dpf-muted)] group-open:inline-flex">Close</span>
          </summary>
          <div className="space-y-3 border-t border-[var(--dpf-border)] p-3">
            <ActivityRoutingWorkbench activityRouting={routingTopology.activityRouting} />
            {showProvider ? (
              <RoutingTopologyPanel
                routingTopology={routingTopology}
                evidenceRange={evidenceRange ?? null}
                onReplayChange={handleReplayChange}
                onControlFilterChange={handleRoutingControlChange}
              />
            ) : null}
            {showA2a ? (
              <>
                <A2aInteractionsPanel
                  coworkers={routingTopology.coworkers}
                  a2aEdges={routingTopology.a2aEdges}
                  a2aLegend={routingTopology.a2aLegend}
                  replayTime={showProvider ? sharedReplay?.time ?? null : null}
                  replayRange={showProvider ? sharedReplay?.range ?? null : null}
                  onFilterChange={handleA2aControlChange}
                />
                <DeliberationLensPanel deliberations={routingTopology.deliberations} />
              </>
            ) : null}
          </div>
        </details>
      </section>

      <details
        aria-label="Activity projection details"
        className="group rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Activity projection details</h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Showing {filteredProjections.length} of {projections.length} activities across {template.label}
            </p>
          </div>
          <span className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)] group-open:hidden">
            Open
          </span>
          <span className="hidden rounded border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)] group-open:inline-flex">
            Close
          </span>
        </summary>

        <div className="space-y-4 border-t border-[var(--dpf-border)] p-4">
          <section aria-label="Map view controls" className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--dpf-text)]">View controls</h3>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  Showing {filteredProjections.length} of {projections.length} activities
                </p>
                <button
                  type="button"
                  onClick={resetView}
                  className="mt-2 text-xs font-medium text-[var(--dpf-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                >
                  Reset view
                </button>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <FilterGroup label="Quick views">
                  {OPERATIONS_MAP_QUICK_VIEWS.map((view) => (
                    <FilterButton
                      key={view.id}
                      active={activeQuickViewId === view.id}
                      label={view.label}
                      title={view.description}
                      onClick={() => applyQuickView(view.id)}
                    />
                  ))}
                  {activeQuickViewId === "custom" ? (
                    <span className="inline-flex min-h-8 items-center rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-1 text-xs text-[var(--dpf-muted)]">
                      Custom
                    </span>
                  ) : null}
                </FilterGroup>
                <FilterGroup label="Sources">
                  {SOURCE_OPTIONS.map((source) => (
                    <FilterButton
                      key={source}
                      active={sourceFilters.includes(source)}
                      label={SOURCE_LABEL[source]}
                      onClick={() => toggleSourceFilter(source)}
                    />
                  ))}
                </FilterGroup>
                <FilterGroup label="Severity">
                  {SEVERITY_OPTIONS.map((severity) => (
                    <FilterButton
                      key={severity}
                      active={severityFilters.includes(severity)}
                      label={capitalizeSeverity(severity)}
                      onClick={() => toggleSeverityFilter(severity)}
                    />
                  ))}
                </FilterGroup>
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section
              aria-label={`${template.label} map`}
              className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
            >
              <div className="border-b border-[var(--dpf-border)] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{template.label}</h3>
                    <p className="text-xs text-[var(--dpf-muted)]">{recentWindowLabel}</p>
                  </div>
                  <span className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
                    Read-only V2
                  </span>
                </div>
              </div>

              <div className="space-y-4 p-4">
                {template.lines.map((line) => (
                  <div key={line.id} className="space-y-3" aria-label={line.label}>
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-[var(--dpf-border)]" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
                        {line.label}
                      </span>
                      <div className="h-px flex-1 bg-[var(--dpf-border)]" />
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      {line.stationIds.map((stationId) => {
                        const station = template.stations.find((candidate) => candidate.id === stationId);
                        if (!station) return null;
                        const stationAgents = agents.filter((agent) => agent.stationId === station.id);
                        // BI-62c4197e — pure band assignment. Actionable severities
                        // (stalled/failed) sort first so the visible cap surfaces
                        // them instead of burying them behind routine activity.
                        const stationTiles = buildStationProjectionTiles(filteredProjections, station.id);
                        const visibleTiles = stationTiles.slice(0, STATION_TILE_VISIBLE_LIMIT);
                        const hiddenTileCount = stationTiles.length - visibleTiles.length;
                        const stationSelected = selected.kind === "station" && selected.id === station.id;
                        const projectionSelectedHere =
                          selected.kind === "projection" &&
                          stationTiles.some((tile) => tile.projectionId === selected.id);
                        const isSelected = stationSelected || projectionSelectedHere;

                        return (
                          <div
                            key={station.id}
                            data-station-card={station.id}
                            className={[
                              "min-h-44 rounded-lg border p-3 text-left transition-colors",
                              isSelected
                                ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]"
                                : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]",
                            ].join(" ")}
                          >
                            <button
                              type="button"
                              aria-pressed={stationSelected}
                              onClick={() => setSelected({ kind: "station", id: station.id })}
                              className="flex w-full items-start justify-between gap-2 rounded text-left transition-colors hover:text-[var(--dpf-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                            >
                              <div>
                                <h4 className="text-sm font-semibold text-[var(--dpf-text)]">{station.label}</h4>
                                <p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--dpf-muted)]">
                                  {station.description}
                                </p>
                              </div>
                              <span className="rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-[10px] text-[var(--dpf-muted)]">
                                {stationTiles.length}
                              </span>
                            </button>

                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {stationAgents.slice(0, 3).map((agent) => (
                                <span
                                  key={agent.agentId}
                                  className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] text-[var(--dpf-text)]"
                                >
                                  {agent.name}
                                </span>
                              ))}
                              {stationAgents.length > 3 ? (
                                <span className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[10px] text-[var(--dpf-muted)]">
                                  +{stationAgents.length - 3}
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-3 space-y-1">
                              {visibleTiles.map((tile) => (
                                <button
                                  key={tile.projectionId}
                                  type="button"
                                  data-projection-tile
                                  aria-pressed={selected.kind === "projection" && selected.id === tile.projectionId}
                                  aria-label={tile.accessibleLabel}
                                  title={tile.accessibleLabel}
                                  onClick={() => setSelected({ kind: "projection", id: tile.projectionId })}
                                  className={[
                                    "block w-full truncate rounded border px-2 py-1 text-left text-[10px] transition-colors hover:border-[var(--dpf-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
                                    SEVERITY_CLASS[tile.severity],
                                  ].join(" ")}
                                >
                                  {tile.summary}
                                </button>
                              ))}
                              {hiddenTileCount > 0 ? (
                                <button
                                  type="button"
                                  data-projection-overflow
                                  onClick={() => setSelected({ kind: "station", id: station.id })}
                                  className="block w-full rounded border border-dashed border-[var(--dpf-border)] px-2 py-1 text-left text-[10px] text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                                >
                                  +{hiddenTileCount} more — open station
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4" aria-label="Map inspector">
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Inspector</h3>
              {selectedStation ? (
                <StationInspector station={selectedStation} agents={agents} projections={filteredProjections} onSelect={setSelected} />
              ) : null}
              {selectedAgent ? <AgentInspector agent={selectedAgent} /> : null}
              {selectedProjection ? <ProjectionInspector projection={selectedProjection} /> : null}
            </aside>
          </div>
        </div>
      </details>
    </div>
  );
}

function RoutingTopologyPanel({
  routingTopology,
  evidenceRange,
  onReplayChange,
  onControlFilterChange,
}: {
  routingTopology: OperationsMapRoutingTopology;
  evidenceRange?: OperationsMapEvidenceRange | null;
  onReplayChange?: (selectedTime: number, range: RoutingTimelineRange) => void;
  onControlFilterChange?: (criteria: RoutingControlCriteria) => void;
}) {
  const mapShellRef = useRef<HTMLDivElement>(null);
  const pinnedMarkerRef = useRef<string | null>(null);
  const [routeFilter, setRouteFilter] = useState<RoutingRouteFilter>("all");
  const [providerTypeFilter, setProviderTypeFilter] = useState<RoutingProviderTypeFilter>("llm");
  const [providerFilter, setProviderFilter] = useState("all");
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ROUTING_ZOOM_INDEX);
  const [timelineZoomIndex, setTimelineZoomIndex] = useState(DEFAULT_ROUTING_TIMELINE_ZOOM_INDEX);
  const [replayTimestamp, setReplayTimestamp] = useState<number | null>(null);
  const [timelineCenterTimestamp, setTimelineCenterTimestamp] = useState<number | null>(null);
  const [inspectedMarkerId, setInspectedMarkerId] = useState<string | null>(null);
  const [pinnedMarkerId, setPinnedMarkerId] = useState<string | null>(null);
  const [symbolDetailAnchor, setSymbolDetailAnchor] = useState<RoutingSymbolAnchor | null>(null);
  const zoomLevel = ROUTING_ZOOM_LEVELS[zoomIndex] ?? 1;
  const timelineZoomLevel = ROUTING_TIMELINE_ZOOM_LEVELS[timelineZoomIndex] ?? 1;
  const baseTimelineRange = useMemo(
    () => buildTimelineRange(routingTopology, evidenceRange ?? null),
    [routingTopology, evidenceRange],
  );
  const historyBoundary = parseRoutingTimestamp(evidenceRange?.earliest ?? null);
  const selectedReplayTime = clampTimelineTimestamp(replayTimestamp ?? baseTimelineRange.current, baseTimelineRange);
  const timelineWindowAnchor = clampTimelineTimestamp(timelineCenterTimestamp ?? baseTimelineRange.current, baseTimelineRange);
  const timelineRange = useMemo(
    () => buildTimelineWindow(baseTimelineRange, timelineWindowAnchor, timelineZoomLevel),
    [baseTimelineRange, timelineWindowAnchor, timelineZoomLevel],
  );
  const selectedTimelinePercent = timelineMarkerPosition(selectedReplayTime, timelineRange);

  // Publish the replay playhead so the A2A interaction band can scrub in
  // lock-step (shared replay window). Fires only when the playhead or window
  // actually changes; the parent's handler is stable (useCallback).
  useEffect(() => {
    onReplayChange?.(selectedReplayTime, timelineRange);
  }, [onReplayChange, selectedReplayTime, timelineRange]);

  // Publish the resolved provider-side control filters so the preview canvas
  // (Stage D) mirrors this panel exactly. Stable parent handler (useCallback).
  useEffect(() => {
    onControlFilterChange?.({ routeFilter, providerTypeFilter, providerFilter });
  }, [onControlFilterChange, routeFilter, providerTypeFilter, providerFilter]);

  const providersById = useMemo(
    () => new Map(routingTopology.providers.map((provider) => [provider.providerId, provider])),
    [routingTopology.providers],
  );
  const providerTypeFilteredProviders = useMemo(
    () => routingTopology.providers.filter((provider) => providerMatchesTypeFilter(provider, providerTypeFilter)),
    [providerTypeFilter, routingTopology.providers],
  );
  const controlFilteredRoutes = useMemo(
    () =>
      routingTopology.routes.filter((route) => {
        const routeMatches = routeFilter === "all" || route.state === routeFilter;
        const provider = providersById.get(route.providerId);
        const providerMatches = providerFilter === "all"
          ? providerMatchesTypeFilter(provider, providerTypeFilter)
          : route.providerId === providerFilter;
        return routeMatches && providerMatches;
      }),
    [providerFilter, providerTypeFilter, providersById, routeFilter, routingTopology.routes],
  );
  const replayFilteredRoutes = useMemo(
    () => controlFilteredRoutes.filter((route) => routeVisibleAtReplayTime(route, selectedReplayTime, timelineRange)),
    [controlFilteredRoutes, selectedReplayTime, timelineRange],
  );
  const displayRoutes = useMemo(() => aggregateRoutesForDisplay(replayFilteredRoutes), [replayFilteredRoutes]);
  const visibleCoworkerIds = useMemo(
    () => {
      const ids = new Set(controlFilteredRoutes.map((route) => route.coworkerId));
      routingTopology.markers.forEach((marker) => {
        if (marker.coworkerId && markerMatchesRouteFilter(marker, routeFilter)) ids.add(marker.coworkerId);
      });
      return ids;
    },
    [controlFilteredRoutes, routeFilter, routingTopology.markers],
  );
  const visibleProviderIds = useMemo(
    () => {
      const ids = new Set<string>();
      if (routeFilter === "all") {
        providerTypeFilteredProviders.forEach((provider) => {
          if (providerFilter === "all" || provider.providerId === providerFilter) ids.add(provider.providerId);
        });
      }
      controlFilteredRoutes.forEach((route) => ids.add(route.providerId));
      routingTopology.markers.forEach((marker) => {
        if (!marker.routeId && marker.providerId && markerMatchesRouteFilter(marker, routeFilter)) {
          if (providerFilter === "all" || marker.providerId === providerFilter) {
            if (providerMatchesTypeFilter(providersById.get(marker.providerId), providerTypeFilter)) {
              ids.add(marker.providerId);
            }
          }
        }
      });
      return ids;
    },
    [controlFilteredRoutes, providerFilter, providerTypeFilter, providerTypeFilteredProviders, providersById, routeFilter, routingTopology.markers],
  );
  const visibleRouteIds = useMemo(
    () => new Set(displayRoutes.flatMap((route) => route.sourceRouteIds)),
    [displayRoutes],
  );
  const visibleCoworkers = useMemo(
    () => routingTopology.coworkers.filter((coworker) => visibleCoworkerIds.has(coworker.agentId)),
    [routingTopology.coworkers, visibleCoworkerIds],
  );
  const coworkersById = useMemo(
    () => new Map(routingTopology.coworkers.map((coworker) => [coworker.agentId, coworker])),
    [routingTopology.coworkers],
  );
  const visibleProviders = useMemo(
    () => routingTopology.providers.filter((provider) => visibleProviderIds.has(provider.providerId)),
    [routingTopology.providers, visibleProviderIds],
  );
  const visibleMarkers = useMemo(
    () =>
      routingTopology.markers.filter((marker) => {
        if (!markerVisibleAtReplayTime(marker, selectedReplayTime, timelineRange)) return false;
        if (marker.routeId) return visibleRouteIds.has(marker.routeId);
        const providerMatches = !marker.providerId || visibleProviderIds.has(marker.providerId);
        const coworkerMatches = !marker.coworkerId || visibleCoworkerIds.has(marker.coworkerId);
        return providerMatches && coworkerMatches;
      }),
    [routingTopology.markers, selectedReplayTime, timelineRange, visibleCoworkerIds, visibleProviderIds, visibleRouteIds],
  );
  const routedProviderIds = useMemo(
    () => new Set(displayRoutes.map((route) => route.providerId)),
    [displayRoutes],
  );
  const coworkerPositions = useMemo(
    () =>
      mapNodePositions(
        visibleCoworkers.map((coworker) => coworker.agentId),
        ROUTING_LAYOUT.coworkerNodeX,
        ROUTING_LAYOUT.startY,
        ROUTING_LAYOUT.endY,
      ),
    [visibleCoworkers],
  );
  const providerPositions = useMemo(
    () =>
      mapNodePositions(
        visibleProviders.map((provider) => provider.providerId),
        ROUTING_LAYOUT.providerNodeX,
        ROUTING_LAYOUT.startY,
        ROUTING_LAYOUT.endY,
      ),
    [visibleProviders],
  );
  const routeMarkersByRouteId = useMemo(
    () => {
      const markersByRouteId = new Map<string, OperationsMapRoutingTopology["markers"][number][]>();
      displayRoutes.forEach((route) => {
        const sourceRouteIds = new Set(route.sourceRouteIds);
        const routeMarkers = visibleMarkers.filter((marker) => marker.routeId && sourceRouteIds.has(marker.routeId));
        markersByRouteId.set(route.id, routeMarkers);
      });
      return markersByRouteId;
    },
    [displayRoutes, visibleMarkers],
  );
  const providerMarkersByProviderId = useMemo(
    () => {
      const markersByProviderId = new Map<string, OperationsMapRoutingTopology["markers"][number][]>();
      visibleMarkers.forEach((marker) => {
        if (marker.routeId || !marker.providerId) return;
        const providerMarkers = markersByProviderId.get(marker.providerId) ?? [];
        providerMarkers.push(marker);
        markersByProviderId.set(marker.providerId, providerMarkers);
      });
      return markersByProviderId;
    },
    [visibleMarkers],
  );
  const coworkerMarkersByCoworkerId = useMemo(
    () => {
      const markersByCoworkerId = new Map<string, OperationsMapRoutingTopology["markers"][number][]>();
      visibleMarkers.forEach((marker) => {
        if (marker.routeId || !marker.coworkerId || marker.providerId) return;
        const coworkerMarkers = markersByCoworkerId.get(marker.coworkerId) ?? [];
        coworkerMarkers.push(marker);
        markersByCoworkerId.set(marker.coworkerId, coworkerMarkers);
      });
      return markersByCoworkerId;
    },
    [visibleMarkers],
  );
  const symbolCount = useMemo(
    () => {
      let count = 0;
      routeMarkersByRouteId.forEach((markers) => {
        count += markers.length;
      });
      coworkerMarkersByCoworkerId.forEach((markers) => {
        count += markers.length;
      });
      providerMarkersByProviderId.forEach((markers) => {
        count += markers.length;
      });
      return count;
    },
    [coworkerMarkersByCoworkerId, providerMarkersByProviderId, routeMarkersByRouteId],
  );
  const visibleProviderSymbolIds = useMemo(
    () => {
      const ids = new Set<string>();
      providerMarkersByProviderId.forEach((markers) => {
        markers.forEach((marker) => {
          if (marker.providerId) ids.add(marker.providerId);
        });
      });
      return ids;
    },
    [providerMarkersByProviderId],
  );
  const providerSymbolPositions = useMemo(
    () => {
      const providerIds = visibleProviders
        .filter((provider) => visibleProviderSymbolIds.has(provider.providerId))
        .map((provider) => provider.providerId);
      return mapNodePositions(providerIds, ROUTING_LAYOUT.providerSymbolX, ROUTING_LAYOUT.startY, ROUTING_LAYOUT.endY - 20);
    },
    [visibleProviderSymbolIds, visibleProviders],
  );
  const pulsingRoutes = useMemo(
    () => displayRoutes.filter((route) => route.state !== "historical").slice(0, 10),
    [displayRoutes],
  );
  const routingSummary = useMemo(
    () => summarizeVisibleRouting(displayRoutes, visibleProviders),
    [displayRoutes, visibleProviders],
  );
  const visibleMcpProviderCount = useMemo(
    () => visibleProviders.filter((provider) => provider.providerType === "mcp").length,
    [visibleProviders],
  );
  const activeMarker = useMemo(
    () => {
      const activeMarkerId = pinnedMarkerId ?? inspectedMarkerId;
      if (!activeMarkerId) return null;
      return visibleMarkers.find((marker) => marker.id === activeMarkerId) ?? null;
    },
    [inspectedMarkerId, pinnedMarkerId, visibleMarkers],
  );
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ROUTING_ZOOM_LEVELS.length - 1;
  const canTimelineZoomOut = timelineZoomIndex > 0;
  const canTimelineZoomIn = timelineZoomIndex < ROUTING_TIMELINE_ZOOM_LEVELS.length - 1;
  const scrubReplayTimeline = (percent: number) => {
    setReplayTimestamp(timestampFromReplayPercent(timelineRange, percent));
  };
  const setProviderType = (nextProviderType: RoutingProviderTypeFilter) => {
    setProviderTypeFilter(nextProviderType);
    setProviderFilter("all");
  };
  const zoomTimelineAroundPlayhead = (nextIndex: number) => {
    setTimelineCenterTimestamp(selectedReplayTime);
    setTimelineZoomIndex(Math.min(ROUTING_TIMELINE_ZOOM_LEVELS.length - 1, Math.max(0, nextIndex)));
  };
  const resetTimelineZoom = () => {
    setTimelineZoomIndex(DEFAULT_ROUTING_TIMELINE_ZOOM_INDEX);
    setTimelineCenterTimestamp(null);
  };
  const inspectMarker = (markerId: string, event: RoutingSymbolEvent) => {
    setInspectedMarkerId(markerId);
    setSymbolDetailAnchor(anchorSymbolDetail(event, mapShellRef.current));
  };
  const clearInspectedMarker = (markerId: string) => {
    if (pinnedMarkerRef.current === markerId) return;
    setInspectedMarkerId((current) => (current === markerId ? null : current));
    setSymbolDetailAnchor(null);
  };
  const selectMarker = (markerId: string, event: RoutingSymbolEvent) => {
    pinnedMarkerRef.current = markerId;
    setPinnedMarkerId(markerId);
    setInspectedMarkerId(markerId);
    setSymbolDetailAnchor(anchorSymbolDetail(event, mapShellRef.current));
  };

  return (
    <section aria-label="Provider routing topology" className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)]">
      <div ref={mapShellRef} className="relative min-h-[calc(100vh-9rem)]">
        {visibleProviders.length > 0 || visibleCoworkers.length > 0 ? (
          <svg
            className="absolute inset-0 h-full w-full bg-[var(--dpf-surface-1)]"
            viewBox={routingViewBox(zoomLevel)}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Coworker provider routing network"
          >
              <defs>
                {ROUTING_ROUTE_STATES.map((state) => (
                  <marker
                    key={state}
                    id={`routing-arrow-${state}`}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={routingLineStroke(state)} />
                  </marker>
                ))}
              </defs>

              <rect
                x={ROUTING_LAYOUT.panel.x}
                y={ROUTING_LAYOUT.panel.y}
                width={ROUTING_LAYOUT.panel.width}
                height={ROUTING_LAYOUT.panel.height}
                rx="14"
                fill="var(--dpf-bg)"
                opacity="0.28"
              />
              <line
                x1={ROUTING_LAYOUT.coworkerLaneX}
                y1="70"
                x2={ROUTING_LAYOUT.coworkerLaneX}
                y2="500"
                stroke="var(--dpf-border)"
                strokeDasharray="4 8"
                strokeWidth="1"
              />
              <line
                x1={ROUTING_LAYOUT.providerLaneX}
                y1="70"
                x2={ROUTING_LAYOUT.providerLaneX}
                y2="500"
                stroke="var(--dpf-border)"
                strokeDasharray="4 8"
                strokeWidth="1"
              />

              <text x="42" y="34" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
                AI coworkers
              </text>
              <text x="516" y="34" textAnchor="middle" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
                Live routing traffic
              </text>
              <text x="878" y="34" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
                Providers
              </text>

              {displayRoutes.map((route, index) => {
                const from = coworkerPositions.get(route.coworkerId) ?? { x: ROUTING_LAYOUT.coworkerNodeX, y: 258 };
                const to = providerPositions.get(route.providerId) ?? { x: ROUTING_LAYOUT.providerNodeX, y: 258 };
                const d = routePath(from, to, index);
                return (
                  <path
                    key={`${route.id}-bed`}
                    d={d}
                    fill="none"
                    stroke="var(--dpf-surface-1)"
                    strokeOpacity="0.95"
                    strokeWidth={routingLineWidth(route.trafficWeight) + 3}
                    strokeLinecap="round"
                  />
                );
              })}

              {displayRoutes.map((route, index) => {
                const from = coworkerPositions.get(route.coworkerId) ?? { x: ROUTING_LAYOUT.coworkerNodeX, y: 258 };
                const to = providerPositions.get(route.providerId) ?? { x: ROUTING_LAYOUT.providerNodeX, y: 258 };
                const d = routePath(from, to, index);
                return (
                  <path
                    key={route.id}
                    data-routing-line="true"
                    d={d}
                    fill="none"
                    stroke={routingLineStroke(route.state)}
                    strokeDasharray={routingLineDasharray(route.state)}
                    strokeOpacity={routingLineOpacity(route.state)}
                    strokeWidth={routingLineWidth(route.trafficWeight)}
                    strokeLinecap="round"
                    markerEnd={`url(#routing-arrow-${route.state})`}
                  >
                    <title>{`${ROUTE_STATE_LABEL[route.state]}: ${route.summary} (${route.eventCount} event${route.eventCount === 1 ? "" : "s"})`}</title>
                  </path>
                );
              })}

              {pulsingRoutes.map((route, index) => {
                const from = coworkerPositions.get(route.coworkerId) ?? { x: ROUTING_LAYOUT.coworkerNodeX, y: 258 };
                const to = providerPositions.get(route.providerId) ?? { x: ROUTING_LAYOUT.providerNodeX, y: 258 };
                return (
                  <circle key={`${route.id}-pulse`} r="2.6" fill={routingLineStroke(route.state)} opacity="0.95">
                    <animateMotion
                      dur={`${4.2 + (index % 4) * 0.65}s`}
                      begin={`${index * 0.18}s`}
                      repeatCount="indefinite"
                      path={routePath(from, to, index)}
                    />
                  </circle>
                );
              })}

              {displayRoutes.flatMap((route, index) => {
                const markers = routeMarkersByRouteId.get(route.id) ?? [];
                const from = coworkerPositions.get(route.coworkerId) ?? { x: ROUTING_LAYOUT.coworkerNodeX, y: 258 };
                const to = providerPositions.get(route.providerId) ?? { x: ROUTING_LAYOUT.providerNodeX, y: 258 };
                return markers.slice(0, 6).map((marker, markerIndex) => {
                  const point = routeDecisionPoint(from, to, index, markerIndex, Math.min(markers.length, 6));
                  const coworkerLabel = coworkersById.get(route.coworkerId)?.label ?? route.coworkerId;
                  return (
                    <RouteSymbolBadge
                      key={`${route.id}-marker-${marker.id}`}
                      type={marker.type}
                      x={point.x}
                      y={point.y}
                      ringColor={routingLineStroke(route.state)}
                      symbolColor={routingMarkerStroke(marker.type)}
                      label={marker.label}
                      summary={marker.summary}
                      caption={routeSymbolCaption(marker, coworkerLabel)}
                      onInspect={(event) => inspectMarker(marker.id, event)}
                      onClearInspect={() => clearInspectedMarker(marker.id)}
                      onSelectInspect={(event) => selectMarker(marker.id, event)}
                    />
                  );
                });
              })}

              {visibleCoworkers.map((coworker) => {
                const markers = coworkerMarkersByCoworkerId.get(coworker.agentId) ?? [];
                const coworkerPosition = coworkerPositions.get(coworker.agentId) ?? { x: ROUTING_LAYOUT.coworkerNodeX, y: 258 };
                const visibleCoworkerMarkers = markers.slice(0, 4);
                if (visibleCoworkerMarkers.length === 0) return null;
                return (
                  <g key={`coworker-markers-${coworker.agentId}`}>
                    {visibleCoworkerMarkers.map((marker, markerIndex) => {
                      const symbolPoint = {
                        x: ROUTING_LAYOUT.coworkerLaneX + 58,
                        y: coworkerPosition.y + providerSymbolOffset(markerIndex, visibleCoworkerMarkers.length),
                      };
                      return (
                        <g key={`coworker-marker-${marker.id}`}>
                          <line
                            x1={ROUTING_LAYOUT.coworkerLaneX + 14}
                            y1={coworkerPosition.y}
                            x2={symbolPoint.x - 17}
                            y2={symbolPoint.y}
                            stroke={routingMarkerStroke(marker.type)}
                            strokeDasharray="4 5"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                          <RouteSymbolBadge
                            type={marker.type}
                            x={symbolPoint.x}
                            y={symbolPoint.y}
                            ringColor={routingMarkerStroke(marker.type)}
                            symbolColor={routingMarkerStroke(marker.type)}
                            label={marker.label}
                            summary={marker.summary}
                            caption={coworkerMarkerCaption(marker)}
                            onInspect={(event) => inspectMarker(marker.id, event)}
                            onClearInspect={() => clearInspectedMarker(marker.id)}
                            onSelectInspect={(event) => selectMarker(marker.id, event)}
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {visibleProviders.map((provider) => {
                const markers = providerMarkersByProviderId.get(provider.providerId) ?? [];
                const providerPosition = providerPositions.get(provider.providerId) ?? { x: ROUTING_LAYOUT.providerNodeX, y: 190 };
                const symbolLanePosition = providerSymbolPositions.get(provider.providerId) ?? { x: ROUTING_LAYOUT.providerSymbolX, y: providerPosition.y };
                const visibleProviderMarkers = markers.slice(0, 4);
                const hasProviderSideDecisions = visibleProviderMarkers.some(isProviderSideRouteDecisionMarker);
                if (visibleProviderMarkers.length === 0) return null;
                return (
                  <g key={`provider-markers-${provider.providerId}`}>
                    {hasProviderSideDecisions ? (
                      <RouterAuditSource x={ROUTING_LAYOUT.routerAuditX} y={symbolLanePosition.y} />
                    ) : null}
                    {visibleProviderMarkers.map((marker, markerIndex) => {
                      const isProviderSideDecision = isProviderSideRouteDecisionMarker(marker);
                      const isUnattributedDecision = isUnattributedRouteDecisionMarker(marker);
                      const symbolPoint = {
                        x: symbolLanePosition.x,
                        y: symbolLanePosition.y + providerSymbolOffset(markerIndex, visibleProviderMarkers.length),
                      };
                      return (
                        <g key={`provider-marker-${marker.id}`}>
                          {isProviderSideDecision ? (
                            <line
                              x1={ROUTING_LAYOUT.routerAuditX + ROUTING_LAYOUT.routerAuditWidth}
                              y1={symbolPoint.y}
                              x2={symbolPoint.x - 17}
                              y2={symbolPoint.y}
                              stroke={isUnattributedDecision ? "var(--dpf-warning)" : routingMarkerStroke(marker.type)}
                              strokeDasharray="2 6"
                              strokeWidth="1"
                              strokeLinecap="round"
                            />
                          ) : null}
                          <line
                            x1={symbolPoint.x + 17}
                            y1={symbolPoint.y}
                            x2={providerPosition.x - 40}
                            y2={providerPosition.y}
                            stroke={isUnattributedDecision ? "var(--dpf-warning)" : routingMarkerStroke(marker.type)}
                            strokeDasharray="4 5"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                          />
                          <RouteSymbolBadge
                            type={marker.type}
                            x={symbolPoint.x}
                            y={symbolPoint.y}
                            ringColor={isUnattributedDecision ? "var(--dpf-warning)" : routingMarkerStroke(marker.type)}
                            symbolColor={isUnattributedDecision ? "var(--dpf-warning)" : routingMarkerStroke(marker.type)}
                            label={marker.label}
                            summary={marker.summary}
                            caption={providerMarkerCaption(marker)}
                            onInspect={(event) => inspectMarker(marker.id, event)}
                            onClearInspect={() => clearInspectedMarker(marker.id)}
                            onSelectInspect={(event) => selectMarker(marker.id, event)}
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {visibleCoworkers.map((coworker) => {
                const position = coworkerPositions.get(coworker.agentId) ?? { x: ROUTING_LAYOUT.coworkerNodeX, y: 258 };
                return (
                  <g key={coworker.agentId}>
                    <title>{coworker.label}</title>
                    <circle cx={position.x + 82} cy={position.y} r="10" fill="var(--dpf-surface-1)" stroke="var(--dpf-accent)" strokeWidth="2.4" />
                    <circle cx={position.x + 82} cy={position.y} r="4" fill="var(--dpf-accent)" />
                    <text x={position.x + 74} y={position.y - 6} textAnchor="end" className="fill-[var(--dpf-text)] text-[10px] font-semibold">
                      {svgLabel(coworker.label, 40)}
                    </text>
                    <text x={position.x + 74} y={position.y + 9} textAnchor="end" className="fill-[var(--dpf-muted)] text-[8px]">
                      {svgLabel(coworker.stationLabel ?? "Unplaced", 22)}
                    </text>
                  </g>
                );
              })}

              {visibleProviders.map((provider) => {
                const position = providerPositions.get(provider.providerId) ?? { x: ROUTING_LAYOUT.providerNodeX, y: 258 };
                const isRouted = routedProviderIds.has(provider.providerId);
                const providerState = isRouted ? "routed" : "configured-inactive";
                return (
                  <g key={provider.providerId} data-provider-state={providerState}>
                    <ProviderLogoMark provider={provider} x={position.x - 28} y={position.y} isRouted={isRouted} />
                    <text x={position.x + 24} y={position.y - 6} className="fill-[var(--dpf-text)] text-[10px] font-semibold">
                      {svgLabel(provider.label, 48)}
                    </text>
                    <text x={position.x + 24} y={position.y + 9} className="fill-[var(--dpf-muted)] text-[8px]">
                      {svgLabel(`${providerTypeLabel(provider.providerType)} / ${providerNodeStateLabel(provider, isRouted)} / ${formatCurrency(provider.costUsd)} / ${formatTokenCount(provider.tokenTotal)} tok`, 48)}
                    </text>
                    <title>{`${provider.label}: ${providerNodeStateLabel(provider, isRouted)}`}</title>
                  </g>
                );
              })}
            </svg>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--dpf-surface-1)] p-6 text-sm text-[var(--dpf-muted)]">
            No configured provider routing activity or scheduled coworker invocation in the current window.
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Provider routing topology</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
              Coworkers route through providers as live traffic, failover curves, quota pressure, scheduled windows, and local/native LLM decisions.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 lg:justify-end">
            <RoutingStat label="Coworkers" value={visibleCoworkers.length} />
            <RoutingStat label="Providers" value={visibleProviders.length} />
            <RoutingStat label="Routes" value={displayRoutes.length} />
            <RoutingStat label="Events" value={routingSummary.eventCount} />
            <RoutingStat label="MCP" value={visibleMcpProviderCount} />
            <RoutingStat label="Spend" value={formatCurrency(routingSummary.totalCostUsd)} />
            <RoutingStat label="Tokens" value={formatTokenCount(routingSummary.totalTokens)} />
            <RoutingStat label="Symbols" value={symbolCount} />
          </div>
        </div>

        <div className="pointer-events-auto absolute left-4 right-4 top-28 z-20 flex flex-col gap-2 rounded-md bg-[color-mix(in_srgb,var(--dpf-surface-1)_88%,transparent)] px-3 py-2 shadow-sm backdrop-blur lg:top-20 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
              Route filter
            </span>
            {ROUTE_FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={routeFilter === option.id}
                onClick={() => setRouteFilter(option.id)}
                className={[
                  "min-h-7 rounded-full px-2.5 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
                  routeFilter === option.id
                    ? "bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
                    : "text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)]",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
                Provider type
              </span>
              {PROVIDER_TYPE_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={providerTypeFilter === option.id}
                  onClick={() => setProviderType(option.id)}
                  className={[
                    "min-h-7 rounded-full px-2.5 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
                    providerTypeFilter === option.id
                      ? "bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
                      : "text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)]",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="min-w-44">
              <span className="sr-only">Provider filter</span>
              <select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value)}
                className="min-h-8 w-full rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
              >
                <option value="all" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                  {providerTypeFilter === "llm"
                    ? "All LLM providers"
                    : providerTypeFilter === "mcp"
                      ? "All MCP servers"
                      : "All providers"}
                </option>
                {providerTypeFilteredProviders.map((provider) => (
                  <option
                    key={provider.providerId}
                    value={provider.providerId}
                    className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                  >
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1.5">
              <span className="sr-only">Zoom</span>
              <IconButton
                label="Zoom out"
                disabled={!canZoomOut}
                icon={ZoomOut}
                onClick={() => setZoomIndex((current) => Math.max(0, current - 1))}
              />
              <span className="min-w-12 text-center text-xs font-medium text-[var(--dpf-text)]">
                {Math.round(zoomLevel * 100)}%
              </span>
              <IconButton
                label="Zoom in"
                disabled={!canZoomIn}
                icon={ZoomIn}
                onClick={() => setZoomIndex((current) => Math.min(ROUTING_ZOOM_LEVELS.length - 1, current + 1))}
              />
              <IconButton
                label="Reset zoom"
                disabled={zoomIndex === DEFAULT_ROUTING_ZOOM_INDEX}
                icon={RotateCcw}
                onClick={() => setZoomIndex(DEFAULT_ROUTING_ZOOM_INDEX)}
              />
            </div>
          </div>
        </div>

        {activeMarker && symbolDetailAnchor ? (
          <RoutingSymbolDetail
            anchor={symbolDetailAnchor}
            marker={activeMarker}
            coworkersById={coworkersById}
            providersById={providersById}
          />
        ) : null}

        <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 space-y-2">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
            <MapSymbolRail />
            <RouteStyleRail legend={routingTopology.legend} />
          </div>
          <RoutingReplayTimeline
            markers={routingTopology.timeline}
            historyBoundary={historyBoundary}
            range={timelineRange}
            selectedTime={selectedReplayTime}
            value={selectedTimelinePercent}
            zoomLabel={`${timelineZoomLevel}x`}
            canZoomIn={canTimelineZoomIn}
            canZoomOut={canTimelineZoomOut}
            canResetZoom={timelineZoomIndex !== DEFAULT_ROUTING_TIMELINE_ZOOM_INDEX}
            onChange={scrubReplayTimeline}
            onZoomIn={() => zoomTimelineAroundPlayhead(timelineZoomIndex + 1)}
            onZoomOut={() => zoomTimelineAroundPlayhead(timelineZoomIndex - 1)}
            onResetZoom={resetTimelineZoom}
          />
        </div>
      </div>
    </section>
  );
}

function RoutingStat({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="inline-flex rounded-full bg-[color-mix(in_srgb,var(--dpf-surface-1)_88%,transparent)] px-2.5 py-1 shadow-sm backdrop-blur">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">{label}</span>
      <span className="ml-2 text-xs font-semibold text-[var(--dpf-text)]">{value}</span>
    </span>
  );
}

function IconButton({
  label,
  disabled,
  icon: Icon,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
        disabled
          ? "cursor-not-allowed bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] opacity-50"
          : "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] hover:bg-[var(--dpf-accent-soft)]",
      ].join(" ")}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

function MapSymbolRail() {
  return (
    <div
      aria-label="Routing symbol key"
      className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--dpf-surface-1)_88%,transparent)] px-3 py-2 shadow-sm backdrop-blur"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
        Symbols
      </span>
      {ROUTING_SYMBOL_LEGEND.map((item) => (
        <span
          key={item.type}
          title={`${item.title}: ${item.description}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--dpf-text)]"
        >
          <svg className="h-6 w-6" viewBox="0 0 32 32" aria-hidden="true">
            <RouteSymbolBadge
              type={item.type}
              x={16}
              y={16}
              ringColor={routingMarkerStroke(item.type)}
              symbolColor={routingMarkerStroke(item.type)}
              label={item.title}
              summary={item.description}
              compact
            />
          </svg>
          {item.shortLabel}
        </span>
      ))}
    </div>
  );
}

function RouteStyleRail({ legend }: { legend: OperationsMapRoutingTopology["legend"] }) {
  return (
    <div
      aria-label="Route style key"
      className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--dpf-surface-1)_88%,transparent)] px-3 py-2 shadow-sm backdrop-blur"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
        Route styles
      </span>
      {legend.map((item) => (
        <span
          key={item.state}
          title={item.description}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--dpf-text)]"
        >
          <span className={["h-1 w-8 rounded-full", routeLegendClass(item.state)].join(" ")} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function RoutingSymbolDetail({
  anchor,
  coworkersById,
  marker,
  providersById,
}: {
  anchor: RoutingSymbolAnchor;
  coworkersById: Map<string, OperationsMapRoutingTopology["coworkers"][number]>;
  marker: RoutingTopologyMarker;
  providersById: Map<string, RoutingTopologyProvider>;
}) {
  const legend = ROUTING_SYMBOL_LEGEND.find((item) => item.type === marker.type);
  const openLeft = anchor.x > 620;
  const isUnattributedDecision = isUnattributedRouteDecisionMarker(marker);
  const actorLabel = marker.actorKind && marker.actorId
    ? `${capitalize(marker.actorKind)} / ${marker.actorId}`
    : null;
  const coworkerLabel = marker.coworkerId
    ? coworkersById.get(marker.coworkerId)?.label ?? marker.coworkerId
    : isUnattributedDecision
      ? "Missing from RouteDecisionLog"
      : actorLabel
        ? "No AI coworker on this routing event"
      : "Not recorded on this routing event";
  const providerLabel = marker.providerId
    ? providersById.get(marker.providerId)?.label ?? marker.providerId
    : "Not provider-specific";
  const attributionLabel = isUnattributedDecision
    ? "Provider-side router audit; coworker was not captured."
    : actorLabel
      ? `Recorded actor: ${actorLabel}.`
      : null;

  return (
    <div
      data-symbol-detail-popover
      data-symbol-detail-anchor
      role="status"
      className="pointer-events-none absolute z-30 max-w-xs rounded-md border border-[var(--dpf-border)] bg-[color-mix(in_srgb,var(--dpf-surface-1)_94%,transparent)] p-3 text-xs text-[var(--dpf-text)] shadow-lg backdrop-blur"
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: openLeft ? "translate(calc(-100% - 14px), -50%)" : "translate(14px, -50%)",
      }}
    >
      <div className="flex items-start gap-2">
        <svg className="mt-0.5 h-8 w-8 shrink-0" viewBox="0 0 32 32" aria-hidden="true">
          <RouteSymbolBadge
            type={marker.type}
            x={16}
            y={16}
            ringColor={routingMarkerStroke(marker.type)}
            symbolColor={routingMarkerStroke(marker.type)}
            label={legend?.title ?? marker.label}
            summary={marker.summary}
            compact
          />
        </svg>
        <div>
          <p className="font-semibold text-[var(--dpf-text)]">{legend?.title ?? marker.label}</p>
          <p className="mt-0.5 text-[11px] text-[var(--dpf-muted)]">{marker.label}</p>
        </div>
      </div>
      <p className="mt-2 leading-5 text-[var(--dpf-muted)]">{marker.summary}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
        <dt className="font-semibold text-[var(--dpf-muted)]">When</dt>
        <dd className="min-w-0 break-words">{formatRoutingOccurredAt(marker.occurredAt)}</dd>
        <dt className="font-semibold text-[var(--dpf-muted)]">Coworker</dt>
        <dd className="min-w-0 break-words">{coworkerLabel}</dd>
        <dt className="font-semibold text-[var(--dpf-muted)]">Provider</dt>
        <dd className="min-w-0 break-words">{providerLabel}</dd>
        {attributionLabel ? (
          <>
            <dt className="font-semibold text-[var(--dpf-muted)]">Attribution</dt>
            <dd className="min-w-0 break-words">{attributionLabel}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-[var(--dpf-muted)]">Meaning</dt>
        <dd className="min-w-0 break-words">{legend?.description ?? "Routing event marker."}</dd>
      </dl>
    </div>
  );
}

function RoutingReplayTimeline({
  canResetZoom,
  canZoomIn,
  canZoomOut,
  historyBoundary,
  markers,
  onChange,
  onResetZoom,
  onZoomIn,
  onZoomOut,
  range,
  selectedTime,
  value,
  zoomLabel,
}: {
  canResetZoom: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  historyBoundary?: number | null;
  markers: OperationsMapRoutingTopology["timeline"];
  onChange: (value: number) => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  range: RoutingTimelineRange;
  selectedTime: number;
  value: number;
  zoomLabel: string;
}) {
  const currentPosition = timelineCurrentPercent(range);
  const selectedPosition = Math.round(value);
  const timelineTicks = useMemo(() => buildTimelineTicks(range), [range]);
  const spanLabel = timelineSpanLabel(range);
  const visibleMarkers = useMemo(
    () => markers.filter((marker) => timelineMarkerInRange(marker.occurredAt, range)),
    [markers, range],
  );
  const boundaryVisible = typeof historyBoundary === "number"
    && historyBoundary >= range.start
    && historyBoundary <= range.end;
  const boundaryPosition = boundaryVisible ? timelineMarkerPosition(historyBoundary, range) : null;

  return (
    <div
      aria-label="Routing replay timeline"
      className="pointer-events-auto rounded-md bg-[color-mix(in_srgb,var(--dpf-surface-1)_90%,transparent)] px-3 py-2 text-[10px] font-medium text-[var(--dpf-muted)] shadow-sm backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <span className="w-12 text-right">History</span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span>Time scale</span>
            <div className="flex items-center gap-1.5">
              <IconButton
                label="Zoom time scale out"
                disabled={!canZoomOut}
                icon={ZoomOut}
                onClick={onZoomOut}
              />
              <span className="min-w-20 text-center text-[var(--dpf-text)]">
                {zoomLabel} · {spanLabel}
              </span>
              <IconButton
                label="Zoom time scale in"
                disabled={!canZoomIn}
                icon={ZoomIn}
                onClick={onZoomIn}
              />
              <IconButton
                label="Reset time scale"
                disabled={!canResetZoom}
                icon={RotateCcw}
                onClick={onResetZoom}
              />
            </div>
          </div>
          <div className="relative h-16">
          <div className="absolute left-0 right-0 top-5 h-1.5 -translate-y-1/2 rounded-full bg-[var(--dpf-border)]" />
          <div
            className="absolute left-0 top-5 h-1.5 -translate-y-1/2 rounded-full bg-[var(--dpf-accent)]"
            style={{ width: `${selectedPosition}%` }}
          />
          <span
            aria-hidden="true"
            className="absolute top-1 h-11 w-px bg-[var(--dpf-muted)]"
            style={{ left: `${currentPosition}%` }}
          />
          {boundaryPosition !== null ? (
            <span
              data-routing-history-boundary
              role="img"
              aria-label={`Data begins ${formatReplayTime(historyBoundary as number)} — no evidence recorded before this point`}
              title={`Data begins ${formatReplayTime(historyBoundary as number)} — no evidence recorded before this point`}
              className="absolute top-1 z-30 h-11 w-0 border-l border-dashed border-[var(--dpf-warning)]"
              style={{ left: `${boundaryPosition}%` }}
            >
              <span
                aria-hidden="true"
                className="absolute -top-0.5 left-0 -translate-x-1/2 whitespace-nowrap rounded bg-[color-mix(in_srgb,var(--dpf-warning)_18%,var(--dpf-surface-1))] px-1 text-[9px] font-semibold text-[var(--dpf-warning)]"
              >
                Data begins
              </span>
            </span>
          ) : null}
          <span
            data-routing-playhead
            aria-label="Selected replay time"
            className="pointer-events-none absolute top-0 z-40 h-14 w-0.5 -translate-x-1/2 rounded-full bg-[var(--dpf-error)] shadow"
            style={{ left: `${selectedPosition}%` }}
          >
            <span aria-hidden="true" className="absolute -top-0.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-[var(--dpf-error)]" />
            <span aria-hidden="true" className="absolute -bottom-0.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-[var(--dpf-error)]" />
          </span>
          {visibleMarkers.map((marker) => {
            const markerPosition = timelineMarkerPosition(marker.occurredAt, range);
            const markerTimestamp = parseRoutingTimestamp(marker.occurredAt);
            const markerTime = markerTimestamp === null ? "Unknown time" : formatReplayTime(markerTimestamp);
            return (
              <button
                key={marker.id}
                type="button"
                data-routing-event-marker
                aria-label={`${marker.label}: ${markerTime}`}
                title={`${marker.label}: ${markerTime}`}
                onClick={() => onChange(markerPosition)}
                className="absolute top-5 z-30 flex h-8 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                style={{ left: `${markerPosition}%` }}
              >
                <span
                  aria-hidden="true"
                  className="absolute top-1 h-5 w-px rounded-full"
                  style={{ backgroundColor: routingMarkerStroke(marker.markerType) }}
                />
                <span
                  aria-hidden="true"
                  className="relative mt-4 h-3 w-3 rounded-full border border-[var(--dpf-surface-1)] bg-[var(--dpf-surface-2)] shadow-sm"
                  style={{ backgroundColor: routingMarkerStroke(marker.markerType) }}
                />
              </button>
            );
          })}
          {timelineTicks.map((tick) => (
            <RoutingTimelineTick key={tick.id} tick={tick} />
          ))}
          <input
            type="range"
            min={0}
            max={100}
            value={selectedPosition}
            aria-label="Routing replay cursor"
            onChange={(event) => onChange(Number(event.target.value))}
            className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
          />
          </div>
        </div>
        <span className="w-12">Forecast</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <span>{formatReplayTime(range.start)}</span>
        <span className="font-semibold text-[var(--dpf-error)]">Viewing {formatReplayTime(selectedTime)}</span>
        <span>{formatReplayTime(range.end)}</span>
      </div>
      <div className="sr-only">Replay history. Current routing. Future schedule forecast from scheduled and ongoing work.</div>
    </div>
  );
}

function RoutingTimelineTick({ tick }: { tick: RoutingTick }) {
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-0 -translate-x-1/2 text-center"
      style={{ left: `${tick.position}%` }}
      title={formatReplayTime(tick.timestamp)}
    >
      <span
        className={[
          "mx-auto block w-px rounded-full bg-[var(--dpf-border)]",
          tick.major ? "h-4" : "h-2",
        ].join(" ")}
      />
      <span className="mt-0.5 block min-w-12 text-[9px] leading-3 text-[var(--dpf-muted)]">{tick.label}</span>
    </span>
  );
}

function ProviderLogoMark({
  provider,
  x,
  y,
  isRouted,
}: {
  provider: RoutingTopologyProvider;
  x: number;
  y: number;
  isRouted: boolean;
}) {
  const logo = providerLogoFor(provider);
  const stroke = providerNodeStroke(provider, isRouted);

  return (
    <g
      data-provider-logo={logo.key}
      aria-label={`${provider.label} logo`}
      role="img"
      transform={`translate(${x} ${y})`}
    >
      <rect
        x="-45"
        y="-18"
        width="90"
        height="36"
        rx="8"
        fill="var(--dpf-surface-1)"
        stroke={stroke}
        strokeDasharray={isRouted ? undefined : "3 3"}
        strokeWidth="2.2"
      />
      <circle cx="-28" cy="0" r="12" fill="var(--dpf-surface-2)" stroke="var(--dpf-border)" strokeWidth="1" />
      <ProviderBrandGlyph logo={logo} />
      <text x="-10" y="4" className="fill-[var(--dpf-text)] text-[8px] font-bold">
        {svgLabel(logo.wordmark, 11)}
      </text>
    </g>
  );
}

function ProviderBrandGlyph({ logo }: { logo: ProviderLogoDefinition }) {
  const common = {
    fill: "none",
    stroke: "var(--dpf-text)",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
  };

  switch (logo.key) {
    case "anthropic":
      return (
        <g aria-hidden="true">
          <path d="M-31 -6 L-36 7" {...common} />
          <path d="M-31 -6 L-25 7" {...common} />
          <path d="M-34 1 H-28" {...common} />
          <path d="M-22 -6 V7" {...common} />
        </g>
      );
    case "openai":
      return (
        <g aria-hidden="true">
          <circle cx="-28" cy="0" r="6.5" {...common} />
          <path d="M-28 -6.5 C-22 -4 -21 3 -26 6" {...common} />
          <path d="M-34 -2 C-30 -7 -23 -5 -22 1" {...common} />
          <path d="M-32 6 C-36 1 -34 -5 -28 -6.5" {...common} />
        </g>
      );
    case "gemini":
      return (
        <g aria-hidden="true">
          <path d="M-28 -10 C-26 -4 -24 -2 -18 0 C-24 2 -26 4 -28 10 C-30 4 -32 2 -38 0 C-32 -2 -30 -4 -28 -10 Z" fill="var(--dpf-text)" />
        </g>
      );
    case "docker-local":
      return (
        <g aria-hidden="true" {...common}>
          <path d="M-37 1 H-21 V7 H-37 Z" />
          <path d="M-35 -5 H-31 V-1 H-35 Z" />
          <path d="M-30 -5 H-26 V-1 H-30 Z" />
          <path d="M-25 -5 H-21 V-1 H-25 Z" />
        </g>
      );
    case "github":
      return (
        <g aria-hidden="true" {...common}>
          <path d="M-36 -5 H-20 V5 H-36 Z" />
          <path d="M-33 -1 H-31" />
          <path d="M-28 -1 H-23" />
          <path d="M-33 4 H-25" />
        </g>
      );
    case "postgres":
      return (
        <text x="-28" y="4" textAnchor="middle" aria-hidden="true" className="fill-[var(--dpf-text)] text-[8px] font-bold">
          PG
        </text>
      );
    case "browser-use":
      return (
        <g aria-hidden="true" {...common}>
          <circle cx="-29" cy="-1" r="7" />
          <path d="M-36 -1 H-22" />
          <path d="M-29 -8 C-26 -5 -26 3 -29 6" />
          <path d="M-29 -8 C-32 -5 -32 3 -29 6" />
          <path d="M-25 4 L-20 8" />
        </g>
      );
    case "filesystem":
      return (
        <g aria-hidden="true" {...common}>
          <path d="M-37 -5 H-31 L-29 -2 H-19 V7 H-37 Z" />
          <path d="M-34 2 H-22" />
        </g>
      );
    default:
      return (
        <text x="-28" y="4" textAnchor="middle" aria-hidden="true" className="fill-[var(--dpf-text)] text-[8px] font-bold">
          {svgLabel(logo.mark, 3)}
        </text>
      );
  }
}

function RouterAuditSource({ x, y }: { x: number; y: number }) {
  return (
    <g
      data-unattributed-router-source
      transform={`translate(${x} ${y})`}
      aria-label="Router audit source"
    >
      <title>Router audit source for provider-side route decisions</title>
      <rect
        x="0"
        y="-18"
        width={ROUTING_LAYOUT.routerAuditWidth}
        height="36"
        rx="7"
        fill="var(--dpf-surface-1)"
        stroke="var(--dpf-warning)"
        strokeDasharray="3 4"
        strokeWidth="1.1"
      />
      <circle cx="17" cy="0" r="10" fill="var(--dpf-surface-2)" stroke="var(--dpf-warning)" strokeWidth="1.3" />
      <text x="17" y="4" textAnchor="middle" className="fill-[var(--dpf-text)] text-[9px] font-bold">
        ?
      </text>
      <text x="32" y="-3" className="fill-[var(--dpf-text)] text-[8px] font-semibold">
        Router audit
      </text>
      <text x="32" y="9" className="fill-[var(--dpf-muted)] text-[7px]">
        Coworker missing
      </text>
    </g>
  );
}

function RouteSymbolBadge({
  type,
  x,
  y,
  ringColor,
  symbolColor,
  label,
  summary,
  caption,
  compact = false,
  onClearInspect,
  onInspect,
  onSelectInspect,
}: {
  type: OperationsMapRoutingMarkerType;
  x: number;
  y: number;
  ringColor: string;
  symbolColor: string;
  label: string;
  summary: string;
  caption?: string;
  compact?: boolean;
  onClearInspect?: () => void;
  onInspect?: (event: RoutingSymbolEvent) => void;
  onSelectInspect?: (event: RoutingSymbolEvent) => void;
}) {
  const radius = compact ? 12 : 16;
  const glyphSize = compact ? 16 : 20;
  const captionWidth = caption ? Math.min(250, Math.max(92, caption.length * 5.3 + 16)) : 0;

  return (
    <g
      data-route-symbol={type}
      aria-label={`${label}: ${summary}`}
      role={onInspect ? "button" : undefined}
      tabIndex={onInspect ? 0 : undefined}
      className={onInspect ? "cursor-help focus:outline-none" : undefined}
      transform={`translate(${x} ${y})`}
      onBlur={onClearInspect}
      onClick={(event) => {
        (onSelectInspect ?? onInspect)?.(event);
      }}
      onFocus={(event) => onInspect?.(event)}
      onKeyDown={(event) => {
        if (!onInspect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          (onSelectInspect ?? onInspect)?.(event);
        }
      }}
      onMouseEnter={(event) => onInspect?.(event)}
      onMouseLeave={onClearInspect}
    >
      <circle r={radius + 3} fill="var(--dpf-bg)" opacity="0.58" />
      <circle r={radius} fill="var(--dpf-surface-1)" stroke={ringColor} strokeWidth={compact ? 2 : 3} />
      <circle r={radius - 4} fill="var(--dpf-surface-2)" stroke="var(--dpf-border)" strokeWidth="1" />
      <RoutingSymbolGlyph type={type} size={glyphSize} stroke={symbolColor} />
      {caption && !compact ? (
        <g transform={`translate(${radius + 8} -11)`} aria-hidden="true">
          <rect
            x="0"
            y="0"
            width={captionWidth}
            height="22"
            rx="6"
            fill="var(--dpf-bg)"
            stroke="var(--dpf-border)"
            strokeWidth="0.8"
            opacity="0.9"
          />
          <text x="8" y="14" className="fill-[var(--dpf-text)] text-[8px] font-semibold">
            {svgLabel(caption, 44)}
          </text>
        </g>
      ) : null}
      <circle r={radius + 6} fill="transparent" pointerEvents="all" />
    </g>
  );
}

function RoutingSymbolGlyph({
  type,
  size,
  stroke,
}: {
  type: OperationsMapRoutingMarkerType;
  size: number;
  stroke: string;
}) {
  const scale = size / 20;
  const transform = `translate(${-10 * scale} ${-10 * scale}) scale(${scale})`;
  const commonProps = {
    fill: "none",
    stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    vectorEffect: "non-scaling-stroke" as const,
  };

  switch (type) {
    case "decision":
      return (
        <g transform={transform} {...commonProps}>
          <path d="M5 5 C8 5 8 10 11 10 C14 10 14 15 17 15" />
          <circle cx="5" cy="5" r="2" fill="var(--dpf-surface-1)" />
          <circle cx="11" cy="10" r="2" fill="var(--dpf-surface-1)" />
          <circle cx="17" cy="15" r="2" fill="var(--dpf-surface-1)" />
        </g>
      );
    case "quota":
      return (
        <g transform={transform} {...commonProps}>
          <path d="M4 14 A6 6 0 0 1 16 14" />
          <path d="M10 14 L14 8" />
          <path d="M6 16 H14" />
        </g>
      );
    case "error":
      return (
        <g transform={transform} {...commonProps}>
          <path d="M7 3 H13 L17 7 V13 L13 17 H7 L3 13 V7 Z" />
          <path d="M7 7 L13 13" />
          <path d="M13 7 L7 13" />
        </g>
      );
    case "failover":
      return (
        <g transform={transform} {...commonProps}>
          <path d="M4 6 H8 C11 6 11 10 14 10 H17" />
          <path d="M4 14 H8 C11 14 11 10 14 10" />
          <path d="M14 7 L17 10 L14 13" />
        </g>
      );
    case "scheduled":
      return (
        <g transform={transform} {...commonProps}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6 V10 L14 12" />
        </g>
      );
    case "governance":
      return (
        <g transform={transform} {...commonProps}>
          <path d="M10 3 L16 6 V10 C16 14 13.5 16.5 10 17 C6.5 16.5 4 14 4 10 V6 Z" />
          <path d="M7 10 L9 12 L13.5 8" />
        </g>
      );
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function anchorSymbolDetail(event: RoutingSymbolEvent, container: HTMLDivElement | null): RoutingSymbolAnchor {
  const symbolRect = event.currentTarget.getBoundingClientRect();
  const containerRect = container?.getBoundingClientRect();
  if (!containerRect) {
    return {
      x: symbolRect.left + symbolRect.width / 2,
      y: symbolRect.top + symbolRect.height / 2,
    };
  }

  return {
    x: Math.min(containerRect.width - 24, Math.max(24, symbolRect.left - containerRect.left + symbolRect.width / 2)),
    y: Math.min(containerRect.height - 96, Math.max(96, symbolRect.top - containerRect.top + symbolRect.height / 2)),
  };
}

function buildTimelineRange(
  topology: OperationsMapRoutingTopology,
  evidenceRange?: OperationsMapEvidenceRange | null,
): RoutingTimelineRange {
  const fallbackNow = Date.now();
  // Global evidence bounds pin the base range so a windowed refetch (which
  // only carries events inside the fetched window) can't shrink the scrubber
  // — that would feedback-loop: shrink → narrower window fetch → shrink.
  const timestamps = [
    ...topology.timeline.map((marker) => parseRoutingTimestamp(marker.occurredAt)),
    ...topology.routes.map((route) => parseRoutingTimestamp(route.occurredAt)),
    ...topology.markers.map((marker) => parseRoutingTimestamp(marker.occurredAt)),
    parseRoutingTimestamp(evidenceRange?.earliest ?? null),
    parseRoutingTimestamp(evidenceRange?.latest ?? null),
  ].filter((timestamp): timestamp is number => timestamp !== null);
  const currentTimelineMarker = topology.timeline.find((marker) => marker.lane === "current");
  const current = parseRoutingTimestamp(currentTimelineMarker?.occurredAt ?? null) ?? fallbackNow;
  const min = timestamps.length > 0 ? Math.min(...timestamps, current) : current - 1000 * 60 * 60 * 6;
  const max = timestamps.length > 0 ? Math.max(...timestamps, current) : current + 1000 * 60 * 60 * 6;
  const padding = Math.max(1000 * 60 * 45, (max - min) * 0.08);

  return {
    start: min - padding,
    current,
    end: max + padding,
  };
}

function buildTimelineWindow(
  range: RoutingTimelineRange,
  anchorTimestamp: number,
  zoomLevel: number,
): RoutingTimelineRange {
  const fullSpan = Math.max(1, range.end - range.start);
  const visibleSpan = Math.max(1000 * 60 * 15, fullSpan / Math.max(1, zoomLevel));
  if (visibleSpan >= fullSpan) return range;

  const safeAnchor = Math.min(range.end, Math.max(range.start, anchorTimestamp));
  let start = safeAnchor - visibleSpan / 2;
  let end = safeAnchor + visibleSpan / 2;

  if (start < range.start) {
    start = range.start;
    end = range.start + visibleSpan;
  }

  if (end > range.end) {
    end = range.end;
    start = range.end - visibleSpan;
  }

  return {
    start,
    current: range.current,
    end,
  };
}

function timelineCurrentPercent(range: RoutingTimelineRange): number {
  return timelineMarkerPosition(range.current, range);
}

function timestampFromReplayPercent(range: RoutingTimelineRange, percent: number): number {
  const normalized = Math.min(100, Math.max(0, percent)) / 100;
  return range.start + (range.end - range.start) * normalized;
}

function clampTimelineTimestamp(timestamp: number, range: RoutingTimelineRange): number {
  if (!Number.isFinite(timestamp)) return range.current;
  return Math.min(range.end, Math.max(range.start, timestamp));
}

function timelineMarkerPosition(occurredAt: string | number | null, range: RoutingTimelineRange): number {
  const timestamp = typeof occurredAt === "number" ? occurredAt : parseRoutingTimestamp(occurredAt);
  if (timestamp === null || range.end <= range.start) return 50;
  return Math.min(100, Math.max(0, ((timestamp - range.start) / (range.end - range.start)) * 100));
}

function timelineMarkerInRange(occurredAt: string | number | null, range: RoutingTimelineRange): boolean {
  const timestamp = typeof occurredAt === "number" ? occurredAt : parseRoutingTimestamp(occurredAt);
  if (timestamp === null) return true;
  return timestamp >= range.start && timestamp <= range.end;
}

function buildTimelineTicks(range: RoutingTimelineRange): RoutingTick[] {
  const span = Math.max(1, range.end - range.start);
  const tickCount = timelineTickCount(span);

  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = tickCount <= 1 ? 0 : index / (tickCount - 1);
    const timestamp = range.start + span * ratio;

    return {
      id: `routing-tick-${index}-${Math.round(timestamp)}`,
      label: formatTickLabel(timestamp, span),
      major: index === 0 || index === tickCount - 1 || index % 2 === 0,
      position: Math.round(ratio * 1000) / 10,
      timestamp,
    };
  });
}

function timelineTickCount(span: number): number {
  const hour = 1000 * 60 * 60;
  const day = hour * 24;
  if (span <= hour * 8) return 7;
  if (span <= day * 2) return 6;
  return 5;
}

function formatTickLabel(timestamp: number, span: number): string {
  const hour = 1000 * 60 * 60;
  const day = hour * 24;
  const options: Intl.DateTimeFormatOptions = span <= day
    ? { hour: "numeric", minute: "2-digit" }
    : { day: "numeric", hour: "numeric", month: "short" };

  return new Intl.DateTimeFormat("en-US", options).format(new Date(timestamp));
}

function timelineSpanLabel(range: RoutingTimelineRange): string {
  const span = Math.max(0, range.end - range.start);
  const minute = 1000 * 60;
  const hour = minute * 60;
  const day = hour * 24;

  if (span < hour) return `${Math.max(1, Math.round(span / minute))} min span`;
  if (span < day * 2) return `${formatTimelineSpan(Math.round(span / hour), "hr")} span`;
  return `${formatTimelineSpan(Number((span / day).toFixed(span < day * 10 ? 1 : 0)), "day")} span`;
}

function formatTimelineSpan(value: number, unit: "day" | "hr"): string {
  return `${value} ${value === 1 ? unit : `${unit}s`}`;
}

function routeVisibleAtReplayTime(route: RoutingTopologyRoute, selectedTime: number, range: RoutingTimelineRange): boolean {
  const occurredAt = parseRoutingTimestamp(route.occurredAt);
  if (occurredAt === null) return true;
  const replayWindow = replayEventWindow(range);

  if (route.state === "scheduled") {
    return selectedTime >= range.current && selectedTime <= occurredAt + replayWindow;
  }

  if (selectedTime < occurredAt) return false;

  if (route.state === "active" || route.state === "secondary" || route.state === "failover") {
    return selectedTime >= range.current || selectedTime - occurredAt <= replayWindow;
  }

  return selectedTime - occurredAt <= replayWindow;
}

function markerVisibleAtReplayTime(marker: RoutingTopologyMarker, selectedTime: number, range: RoutingTimelineRange): boolean {
  const occurredAt = parseRoutingTimestamp(marker.occurredAt);
  if (occurredAt === null) return selectedTime >= range.current;
  const replayWindow = replayEventWindow(range);

  if (marker.type === "scheduled") {
    return selectedTime >= range.current && selectedTime <= occurredAt + replayWindow;
  }

  return selectedTime >= occurredAt && selectedTime - occurredAt <= replayWindow;
}

function aggregateRoutesForDisplay(routes: RoutingTopologyRoute[]): DisplayRoutingRoute[] {
  const routesByPair = new Map<string, DisplayRoutingRoute>();

  for (const route of routes) {
    const routeKey = `${route.coworkerId}:${route.providerId}`;
    const existing = routesByPair.get(routeKey);
    if (!existing) {
      routesByPair.set(routeKey, {
        ...route,
        eventCount: 1,
        markerIds: [...route.markerIds],
        sourceRouteIds: [route.id],
      });
      continue;
    }

    const nextState = mergeRouteState(existing.state, route.state);
    const nextOccurredAt = latestOccurredAt(existing.occurredAt, route.occurredAt);
    routesByPair.set(routeKey, {
      ...existing,
      id: `${existing.coworkerId}:${existing.providerId}:${nextState}`,
      state: nextState,
      summary: `${existing.eventCount + 1} routing events observed between this coworker and provider.`,
      occurredAt: nextOccurredAt,
      eventCount: existing.eventCount + 1,
      trafficWeight: existing.trafficWeight + route.trafficWeight,
      markerIds: [...new Set([...existing.markerIds, ...route.markerIds])],
      sourceRouteIds: [...existing.sourceRouteIds, route.id],
    });
  }

  return [...routesByPair.values()].map((route) => ({
    ...route,
    trafficWeight: Math.max(1, Math.min(8, Math.log2(route.trafficWeight + 1) * 2)),
    summary: route.eventCount > 1
      ? `${route.eventCount} routing events folded into this visible path. ${route.summary}`
      : route.summary,
  }));
}

function summarizeVisibleRouting(routes: DisplayRoutingRoute[], providers: RoutingTopologyProvider[]) {
  return {
    eventCount: routes.reduce((total, route) => total + route.eventCount, 0),
    totalCostUsd: providers.reduce((total, provider) => total + provider.costUsd, 0),
    totalTokens: providers.reduce((total, provider) => total + provider.tokenTotal, 0),
  };
}

function routeSymbolCaption(marker: RoutingTopologyMarker, coworkerLabel: string): string {
  const legend = ROUTING_SYMBOL_LEGEND.find((item) => item.type === marker.type);
  return `${svgLabel(coworkerLabel, 34)} / ${legend?.shortLabel ?? marker.label}`;
}

function providerMarkerCaption(marker: RoutingTopologyMarker): string | undefined {
  if (isUnattributedRouteDecisionMarker(marker)) return "Router audit / Coworker missing";
  if (isProviderSideRouteDecisionMarker(marker) && marker.actorKind && marker.actorId) {
    return `${capitalize(marker.actorKind)} / ${svgLabel(marker.actorId, 18)}`;
  }
  return undefined;
}

function coworkerMarkerCaption(marker: RoutingTopologyMarker): string | undefined {
  if (marker.type === "scheduled") return "Coworker invocation";
  return undefined;
}

function isUnattributedRouteDecisionMarker(marker: RoutingTopologyMarker): boolean {
  return isProviderSideRouteDecisionMarker(marker) && (!marker.actorKind || marker.actorKind === "legacy_unattributed");
}

function isProviderSideRouteDecisionMarker(marker: RoutingTopologyMarker): boolean {
  return marker.type === "decision" && !marker.routeId && !marker.coworkerId;
}

function mergeRouteState(
  current: OperationsMapRoutingRouteState,
  next: OperationsMapRoutingRouteState,
): OperationsMapRoutingRouteState {
  return routeStatePriority(next) > routeStatePriority(current) ? next : current;
}

function routeStatePriority(state: OperationsMapRoutingRouteState): number {
  switch (state) {
    case "failover":
      return 5;
    case "active":
      return 4;
    case "scheduled":
      return 3;
    case "secondary":
      return 2;
    case "historical":
      return 1;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function latestOccurredAt(left: string | null, right: string | null): string | null {
  const leftTime = parseRoutingTimestamp(left);
  const rightTime = parseRoutingTimestamp(right);
  if (leftTime === null) return right;
  if (rightTime === null) return left;
  return rightTime > leftTime ? right : left;
}

function replayEventWindow(range: RoutingTimelineRange): number {
  return Math.max(1000 * 60 * 45, (range.end - range.start) * 0.2);
}

function parseRoutingTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value < 10 ? 2 : 0,
    style: "currency",
  }).format(value);
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function formatRoutingOccurredAt(value: string | null): string {
  const timestamp = parseRoutingTimestamp(value);
  return timestamp === null ? "Current provider state" : formatReplayTime(timestamp);
}

function formatReplayTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(timestamp));
}

function routeLegendClass(state: OperationsMapRoutingRouteState): string {
  switch (state) {
    case "active":
      return "bg-[var(--dpf-accent)]";
    case "secondary":
      return "bg-[var(--dpf-success)]";
    case "failover":
      return "border-t-4 border-dashed border-[var(--dpf-warning)]";
    case "scheduled":
      return "border-t-4 border-dotted border-[var(--dpf-info)]";
    case "historical":
      return "bg-[var(--dpf-muted)]";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function providerNodeStateLabel(provider: RoutingTopologyProvider, isRouted: boolean): string {
  if (isRouted) return `${provider.kind} / active`;
  const status = provider.status.trim();
  return status && status.toLowerCase() !== "active" ? `configured / ${status}` : "configured / inactive";
}

function providerTypeLabel(type: OperationsMapRoutingProviderType): string {
  switch (type) {
    case "llm":
      return "LLM";
    case "mcp":
      return "MCP";
    case "other":
      return "Other";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function providerNodeStroke(provider: RoutingTopologyProvider, isRouted: boolean): string {
  if (isRouted) return "var(--dpf-accent)";
  if (/disabled|unconfigured|error|degraded|failed|paused/i.test(provider.status)) return "var(--dpf-error)";
  return "var(--dpf-muted)";
}

function providerLogoFor(provider: RoutingTopologyProvider): ProviderLogoDefinition {
  const source = `${provider.providerId} ${provider.label}`.toLowerCase();
  return PROVIDER_LOGO_MATCHERS.find((candidate) => candidate.match.test(source))?.logo ?? {
    key: "provider",
    mark: providerAcronym(provider.label),
    wordmark: provider.label,
  };
}

function providerAcronym(label: string): string {
  const words = label
    .replace(/[^a-z0-9 ]/gi, " ")
    .split(" ")
    .filter((word) => word.length > 0);
  if (words.length === 0) return "AI";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function mapNodePositions(
  ids: string[],
  x: number,
  startY: number,
  endY: number,
  priorityIds?: ReadonlySet<string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const orderedIds = priorityIds ? prioritizeRoutingNodeIds(ids, priorityIds) : ids;
  const count = Math.max(ids.length, 1);
  orderedIds.forEach((id, index) => {
    const y = count === 1 ? (startY + endY) / 2 : startY + ((endY - startY) * index) / (count - 1);
    positions.set(id, { x, y });
  });
  return positions;
}

function prioritizeRoutingNodeIds(ids: string[], priorityIds: ReadonlySet<string>): string[] {
  const routedIds = ids.filter((id) => priorityIds.has(id));
  if (routedIds.length === 0) return ids;

  const inactiveIds = ids.filter((id) => !priorityIds.has(id));
  const centeredSlots = ids
    .map((_, index) => index)
    .sort((left, right) => {
      const center = (ids.length - 1) / 2;
      const leftDistance = Math.abs(left - center);
      const rightDistance = Math.abs(right - center);
      return leftDistance === rightDistance ? left - right : leftDistance - rightDistance;
    });
  const orderedIds = new Array<string>(ids.length);

  [...routedIds, ...inactiveIds].forEach((id, index) => {
    orderedIds[centeredSlots[index] ?? index] = id;
  });

  return orderedIds.filter((id): id is string => Boolean(id));
}

type RoutingPoint = { x: number; y: number };

function routePath(from: RoutingPoint, to: RoutingPoint, index: number): string {
  const points = routeControlPoints(from, to, index);
  return `M ${points.start.x} ${points.start.y} C ${points.controlA.x} ${points.controlA.y}, ${points.controlB.x} ${points.controlB.y}, ${points.end.x} ${points.end.y}`;
}

function routeDecisionPoint(
  from: RoutingPoint,
  to: RoutingPoint,
  routeIndex: number,
  markerIndex: number,
  markerCount: number,
): RoutingPoint {
  const span = Math.min(0.22, Math.max(0.08, markerCount * 0.045));
  const markerStep = markerCount <= 1 ? 0 : markerIndex / Math.max(markerCount - 1, 1);
  const t = 0.5 - span / 2 + markerStep * span;
  const points = routeControlPoints(from, to, routeIndex);
  return cubicBezierPoint(points.start, points.controlA, points.controlB, points.end, t);
}

function routeControlPoints(from: RoutingPoint, to: RoutingPoint, index: number) {
  const bendDirection = index % 2 === 0 ? -1 : 1;
  const verticalDistance = Math.abs(to.y - from.y);
  const bend = bendDirection * Math.min(70, 22 + verticalDistance * 0.18);
  return {
    start: { x: from.x + 82, y: from.y },
    controlA: { x: from.x + 230, y: from.y + bend * 0.3 },
    controlB: { x: to.x - 230, y: (from.y + to.y) / 2 + bend },
    end: { x: to.x - 28, y: to.y },
  };
}

function cubicBezierPoint(start: RoutingPoint, controlA: RoutingPoint, controlB: RoutingPoint, end: RoutingPoint, t: number): RoutingPoint {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT ** 3 * start.x + 3 * oneMinusT ** 2 * t * controlA.x + 3 * oneMinusT * t ** 2 * controlB.x + t ** 3 * end.x,
    y: oneMinusT ** 3 * start.y + 3 * oneMinusT ** 2 * t * controlA.y + 3 * oneMinusT * t ** 2 * controlB.y + t ** 3 * end.y,
  };
}

function routingLineStroke(state: OperationsMapRoutingRouteState): string {
  switch (state) {
    case "active":
      return "var(--dpf-accent)";
    case "secondary":
      return "var(--dpf-success)";
    case "failover":
      return "var(--dpf-warning)";
    case "scheduled":
      return "var(--dpf-info)";
    case "historical":
      return "var(--dpf-muted)";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function routingMarkerStroke(type: OperationsMapRoutingMarkerType): string {
  switch (type) {
    case "decision":
      return "var(--dpf-accent)";
    case "quota":
      return "var(--dpf-warning)";
    case "error":
      return "var(--dpf-error)";
    case "failover":
      return "var(--dpf-warning)";
    case "scheduled":
      return "var(--dpf-info)";
    case "governance":
      return "var(--dpf-success)";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function providerSymbolOffset(index: number, total: number): number {
  const clampedTotal = Math.min(total, 4);
  return (index - (clampedTotal - 1) / 2) * 25;
}

function routingLineDasharray(state: OperationsMapRoutingRouteState): string | undefined {
  switch (state) {
    case "failover":
      return "14 8";
    case "scheduled":
      return "3 9";
    case "historical":
      return "2 7";
    case "active":
    case "secondary":
      return undefined;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function routingLineOpacity(state: OperationsMapRoutingRouteState): number {
  if (state === "historical") return 0.5;
  if (state === "scheduled") return 0.72;
  return 0.95;
}

function routingLineWidth(trafficWeight: number): number {
  return Math.min(5, 1.25 + trafficWeight * 0.45);
}

function routingViewBox(zoomLevel: number): string {
  const baseWidth = ROUTING_LAYOUT.width;
  const baseHeight = ROUTING_LAYOUT.height;
  const width = baseWidth / zoomLevel;
  const height = baseHeight / zoomLevel;
  const x = (baseWidth - width) / 2;
  const y = (baseHeight - height) / 2;
  return `${x} ${y} ${width} ${height}`;
}

function svgLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

const DIMENSION_OPTIONS: Array<{ id: OperationsMapDimension; label: string; hint: string }> = [
  { id: "both", label: "Both", hint: "Provider routing + coworker interactions" },
  { id: "provider", label: "Provider routes", hint: "Provider routing only" },
  { id: "a2a", label: "A2A interactions", hint: "Coworker-to-coworker interactions only" },
];

function DimensionToggle({
  dimension,
  onChange,
}: {
  dimension: OperationsMapDimension;
  onChange: (dimension: OperationsMapDimension) => void;
}) {
  const active = DIMENSION_OPTIONS.find((option) => option.id === dimension) ?? DIMENSION_OPTIONS[0];
  return (
    <div
      role="group"
      aria-label="Operations map dimension"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2"
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
        Dimension
      </span>
      <div className="inline-flex rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-0.5">
        {DIMENSION_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={dimension === option.id}
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={[
              "min-h-7 rounded-full px-3 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
              dimension === option.id
                ? "bg-[var(--dpf-accent-soft)] font-medium text-[var(--dpf-text)]"
                : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="text-xs text-[var(--dpf-muted)]">{active.hint}</span>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={[
        "min-h-8 rounded border px-2.5 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
        active
          ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
          : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function StationInspector({
  station,
  agents,
  projections,
  onSelect,
}: {
  station: OperationsMapTemplate["stations"][number];
  agents: StationedOperationsMapAgent[];
  projections: OperationsMapProjection[];
  onSelect: (selected: SelectedItem) => void;
}) {
  const stationAgents = agents.filter((agent) => agent.stationId === station.id);
  const stationProjections = projections.filter((projection) => projection.location.stationId === station.id);

  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Station</p>
        <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{station.label}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">{station.description}</p>
      </div>

      <InspectorList title="Coworkers">
        {stationAgents.length > 0 ? stationAgents.map((agent) => (
          <button
            key={agent.agentId}
            type="button"
            onClick={() => onSelect({ kind: "agent", id: agent.agentId })}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-left text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
          >
            {agent.name}
          </button>
        )) : (
          <p className="text-xs text-[var(--dpf-muted)]">No coworkers currently placed here.</p>
        )}
      </InspectorList>

      <InspectorList title="Recent activity">
        {stationProjections.length > 0 ? stationProjections.map((projection) => (
          <button
            key={projection.id}
            type="button"
            onClick={() => onSelect({ kind: "projection", id: projection.id })}
            className={[
              "w-full rounded border px-3 py-2 text-left text-xs hover:border-[var(--dpf-accent)]",
              SEVERITY_CLASS[projection.severity],
            ].join(" ")}
          >
            {projection.summary}
          </button>
        )) : (
          <p className="text-xs text-[var(--dpf-muted)]">No recent activity projected here.</p>
        )}
      </InspectorList>
    </div>
  );
}

function AgentInspector({ agent }: { agent: StationedOperationsMapAgent }) {
  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Coworker</p>
        <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{agent.name}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">
          {agent.description ?? "No description recorded."}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <InspectorFact label="Station" value={agent.stationLabel} />
        <InspectorFact label="Tier" value={`Tier ${agent.tier}`} />
        <InspectorFact label="Skills" value={String(agent.counts.skills)} />
        <InspectorFact label="Tool grants" value={String(agent.counts.toolGrants)} />
      </dl>
      <Link href={`/platform/ai/agent/${encodeURIComponent(agent.agentId)}`} className="inline-flex text-sm text-[var(--dpf-accent)] hover:underline">
        Open coworker detail
      </Link>
    </div>
  );
}

function ProjectionInspector({ projection }: { projection: OperationsMapProjection }) {
  const linkItems = [
    projection.links.authorityHref ? { href: projection.links.authorityHref, label: "Open audit row" } : null,
    projection.links.historyHref ? { href: projection.links.historyHref, label: "Open history" } : null,
    projection.links.backlogHref ? { href: projection.links.backlogHref, label: "Open backlog item" } : null,
    projection.links.coworkerHref ? { href: projection.links.coworkerHref, label: "Open coworker" } : null,
  ].filter((item): item is { href: string; label: string } => item !== null);

  // BI-4ab6be39 — detect stalled task-run projections. projectTaskRun
  // renders summary as "${title} (${status})" — when status is "stalled"
  // and the projection has a taskRunId in refs, expose the operator
  // recovery actions (Retry / Abandon / Escalate).
  const isStalledTaskRun =
    projection.source === "task-run" &&
    projection.refs.taskRunId != null &&
    projection.summary.includes("(stalled)");

  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
          {SOURCE_LABEL[projection.source]}
        </p>
        <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{projection.label}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">{projection.summary}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <InspectorFact label="Source" value={SOURCE_LABEL[projection.source]} />
        <InspectorFact label="Severity" value={projection.severity} />
        {projection.refs.threadId ? <InspectorFact label="Thread" value={projection.refs.threadId} /> : null}
        {projection.refs.backlogItemId ? <InspectorFact label="Backlog item" value={projection.refs.backlogItemId} /> : null}
      </dl>
      {isStalledTaskRun && projection.refs.taskRunId ? (
        <StalledTaskRecoveryActions
          taskRunId={projection.refs.taskRunId}
          // Phase is unknown here — we don't carry it in projection.refs.
          // The server action will look it up. Passing null disables the
          // ship-phase confirm branch in the UI (server still enforces
          // ship_phase_requires_force, so this is safe).
          phase={null}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {linkItems.map((item) => (
          <Link key={item.href} href={item.href} className="text-sm text-[var(--dpf-accent)] hover:underline">
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function InspectorList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InspectorFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 break-words font-medium text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}

function toggleFilterOption<T extends string>(current: T[], option: T, allOptions: T[]): T[] {
  if (current.includes(option)) return current.filter((candidate) => candidate !== option);
  return allOptions.filter((candidate) => candidate === option || current.includes(candidate));
}

function capitalizeSeverity(severity: OperationsMapSeverity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
