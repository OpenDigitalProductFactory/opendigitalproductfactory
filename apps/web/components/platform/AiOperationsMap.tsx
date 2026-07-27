"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  OperationsMapProjection,
  OperationsMapProjectionSource,
  OperationsMapQuickViewId,
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
  getDefaultA2aFilterPreference,
  getDefaultOperationsMapDimension,
  loadOperationsMapDimension,
  loadOperationsMapViewPreference,
  saveOperationsMapDimension,
  saveOperationsMapViewPreference,
  type OperationsMapDimension,
  type OperationsMapStoredQuickViewId,
} from "./ai-operations-map-prefs";
import {
  applyA2aControlFilters,
  applyRoutingControlFilters,
  type A2aControlCriteria,
  type RoutingControlCriteria,
} from "./operations-control-filters";
import { ActivityRoutingWorkbench } from "./ActivityRoutingWorkbench";
import { DeliberationLensPanel } from "./DeliberationLensPanel";
import { OperationsTopologyCanvas } from "./OperationsTopologyCanvas";
import {
  OperationsTopologyControls,
  type OperationsTopologyReplayRange,
} from "./OperationsTopologyControls";
import { RoutingArchitectureOverview } from "./RoutingArchitectureOverview";
import { StalledTaskRecoveryActions } from "./StalledTaskRecoveryActions";

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
  evidenceRange?: OperationsMapEvidenceRange | null;
  onReplayWindowChange?: (window: { time: number; start: number; end: number }) => void;
};

const SOURCE_LABEL: Record<OperationsMapProjectionSource, string> = {
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
const STATION_TILE_VISIBLE_LIMIT = 4;
const DEFAULT_QUICK_VIEW_ID: OperationsMapQuickViewId = "all";
const DEFAULT_QUICK_VIEW_FILTERS = getOperationsMapQuickViewFilters(DEFAULT_QUICK_VIEW_ID);

const SEVERITY_CLASS: Record<OperationsMapSeverity, string> = {
  normal: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
  attention: "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]",
  warning: "border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]",
  critical: "border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]",
};

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
  const [selected, setSelected] = useState<SelectedItem>({
    kind: "station",
    id: template.stations[0]?.id ?? "",
  });
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
  const [sharedReplay, setSharedReplay] = useState<{
    time: number;
    range: OperationsTopologyReplayRange;
  } | null>(null);
  const [routingControl, setRoutingControl] = useState<RoutingControlCriteria>({
    routeFilter: "all",
    providerTypeFilter: "llm",
    providerFilter: "all",
  });
  const [a2aControl, setA2aControl] = useState<A2aControlCriteria>(getDefaultA2aFilterPreference());
  const [dimensionHydrated, setDimensionHydrated] = useState(false);
  const [preferenceHydrated, setPreferenceHydrated] = useState(false);

  const filteredProjections = useMemo(
    () => filterOperationsMapProjections(projections, {
      sources: sourceFilters,
      severities: severityFilters,
    }),
    [projections, severityFilters, sourceFilters],
  );
  const canvasTopology = useMemo(() => {
    const provider = applyRoutingControlFilters(routingTopology, routingControl);
    return {
      ...routingTopology,
      routes: provider.routes,
      providers: provider.providers,
      markers: provider.markers,
      a2aEdges: applyA2aControlFilters(routingTopology.a2aEdges, a2aControl),
    };
  }, [a2aControl, routingControl, routingTopology]);

  useEffect(() => {
    const preference = loadOperationsMapViewPreference();
    setActiveQuickViewId(preference.quickViewId);
    setSourceFilters(preference.filters.sources);
    setSeverityFilters(preference.filters.severities);
    setPreferenceHydrated(true);
  }, []);

  useEffect(() => {
    if (!preferenceHydrated) return;
    saveOperationsMapViewPreference({
      quickViewId: activeQuickViewId,
      filters: { sources: sourceFilters, severities: severityFilters },
    });
  }, [activeQuickViewId, preferenceHydrated, severityFilters, sourceFilters]);

  useEffect(() => {
    setDimension(loadOperationsMapDimension());
    setDimensionHydrated(true);
  }, []);

  useEffect(() => {
    if (dimensionHydrated) saveOperationsMapDimension(dimension);
  }, [dimension, dimensionHydrated]);

  const handleReplayChange = useCallback(
    (time: number, range: OperationsTopologyReplayRange) => {
      setSharedReplay({ time, range });
      onReplayWindowChange?.({ time, start: range.start, end: range.end });
    },
    [onReplayWindowChange],
  );
  const handleRoutingControlChange = useCallback(
    (criteria: RoutingControlCriteria) => setRoutingControl(criteria),
    [],
  );
  const handleA2aControlChange = useCallback(
    (criteria: A2aControlCriteria) => setA2aControl(criteria),
    [],
  );

  const showProvider = dimension === "provider" || dimension === "both";
  const showA2a = dimension === "a2a" || dimension === "both";

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
    setSourceFilters(DEFAULT_QUICK_VIEW_FILTERS.sources);
    setSeverityFilters(DEFAULT_QUICK_VIEW_FILTERS.severities);
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
          <p>Designed routing, observed evidence, and one technical topology for provider and coworker interactions.</p>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Technical topology</h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              One map, one replay window, and one evidence table.
            </p>
          </div>
          <DimensionToggle dimension={dimension} onChange={setDimension} />
        </div>

        <OperationsTopologyControls
          topology={routingTopology}
          dimension={dimension}
          evidenceRange={evidenceRange ?? null}
          onRoutingChange={handleRoutingControlChange}
          onA2aChange={handleA2aControlChange}
          onReplayChange={handleReplayChange}
        />

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
            <DisclosureLabel />
          </summary>
          <div className="space-y-3 border-t border-[var(--dpf-border)] p-3">
            <ActivityRoutingWorkbench activityRouting={routingTopology.activityRouting} />
            {showA2a ? <DeliberationLensPanel deliberations={routingTopology.deliberations} /> : null}
            {!showProvider && !showA2a ? (
              <p className="text-sm text-[var(--dpf-muted)]">Select a topology dimension to inspect diagnostics.</p>
            ) : null}
          </div>
        </details>
      </section>

      <ActivityProjectionDetails
        template={template}
        agents={agents}
        projections={projections}
        filteredProjections={filteredProjections}
        recentWindowLabel={recentWindowLabel}
        selected={selected}
        selectedStation={selectedStation}
        selectedAgent={selectedAgent}
        selectedProjection={selectedProjection}
        activeQuickViewId={activeQuickViewId}
        sourceFilters={sourceFilters}
        severityFilters={severityFilters}
        onSelect={setSelected}
        onQuickView={applyQuickView}
        onReset={resetView}
        onToggleSource={(source) => {
          setActiveQuickViewId("custom");
          setSourceFilters((current) => toggleRequired(current, source, SOURCE_OPTIONS));
        }}
        onToggleSeverity={(severity) => {
          setActiveQuickViewId("custom");
          setSeverityFilters((current) => toggleRequired(current, severity, SEVERITY_OPTIONS));
        }}
      />
    </div>
  );
}

const DIMENSION_OPTIONS: Array<{ id: OperationsMapDimension; label: string; hint: string }> = [
  { id: "both", label: "Both", hint: "Provider routing and coworker interactions" },
  { id: "provider", label: "Provider routes", hint: "Provider routing only" },
  { id: "a2a", label: "A2A interactions", hint: "Coworker interactions only" },
];

function DimensionToggle({
  dimension,
  onChange,
}: {
  dimension: OperationsMapDimension;
  onChange: (dimension: OperationsMapDimension) => void;
}) {
  return (
    <div role="group" aria-label="Operations map dimension" className="flex flex-wrap gap-1 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-1">
      {DIMENSION_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={dimension === option.id}
          title={option.hint}
          onClick={() => onChange(option.id)}
          className={[
            "min-h-11 rounded-full px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
            dimension === option.id
              ? "bg-[var(--dpf-accent-soft)] font-medium text-[var(--dpf-text)]"
              : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ActivityProjectionDetails({
  template,
  agents,
  projections,
  filteredProjections,
  recentWindowLabel,
  selected,
  selectedStation,
  selectedAgent,
  selectedProjection,
  activeQuickViewId,
  sourceFilters,
  severityFilters,
  onSelect,
  onQuickView,
  onReset,
  onToggleSource,
  onToggleSeverity,
}: {
  template: OperationsMapTemplate;
  agents: StationedOperationsMapAgent[];
  projections: OperationsMapProjection[];
  filteredProjections: OperationsMapProjection[];
  recentWindowLabel: string;
  selected: SelectedItem;
  selectedStation: OperationsMapTemplate["stations"][number] | null;
  selectedAgent: StationedOperationsMapAgent | null;
  selectedProjection: OperationsMapProjection | null;
  activeQuickViewId: OperationsMapStoredQuickViewId;
  sourceFilters: OperationsMapProjectionSource[];
  severityFilters: OperationsMapSeverity[];
  onSelect: (selected: SelectedItem) => void;
  onQuickView: (viewId: OperationsMapQuickViewId) => void;
  onReset: () => void;
  onToggleSource: (source: OperationsMapProjectionSource) => void;
  onToggleSeverity: (severity: OperationsMapSeverity) => void;
}) {
  return (
    <details aria-label="Activity projection details" className="group rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Activity projection details</h2>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Showing {filteredProjections.length} of {projections.length} activities across {template.label}
          </p>
        </div>
        <DisclosureLabel />
      </summary>
      <div className="space-y-4 border-t border-[var(--dpf-border)] p-4">
        <section aria-label="Map view controls" className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">View controls</h3>
            <button type="button" onClick={onReset} className="min-h-11 rounded px-3 py-2 text-xs font-medium text-[var(--dpf-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]">
              Reset view
            </button>
          </div>
          <FilterGroup label="Quick views">
            {OPERATIONS_MAP_QUICK_VIEWS.map((view) => (
              <FilterButton key={view.id} active={activeQuickViewId === view.id} label={view.label} title={view.description} onClick={() => onQuickView(view.id)} />
            ))}
          </FilterGroup>
          <FilterGroup label="Sources">
            {SOURCE_OPTIONS.map((source) => (
              <FilterButton key={source} active={sourceFilters.includes(source)} label={SOURCE_LABEL[source]} onClick={() => onToggleSource(source)} />
            ))}
          </FilterGroup>
          <FilterGroup label="Severity">
            {SEVERITY_OPTIONS.map((severity) => (
              <FilterButton key={severity} active={severityFilters.includes(severity)} label={capitalize(severity)} onClick={() => onToggleSeverity(severity)} />
            ))}
          </FilterGroup>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section aria-label={`${template.label} map`} className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
            <div className="border-b border-[var(--dpf-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{template.label}</h3>
              <p className="text-xs text-[var(--dpf-muted)]">{recentWindowLabel}</p>
            </div>
            <div className="space-y-4 p-4">
              {template.lines.map((line) => (
                <div key={line.id} className="space-y-3" aria-label={line.label}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{line.label}</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {line.stationIds.map((stationId) => {
                      const station = template.stations.find((candidate) => candidate.id === stationId);
                      if (!station) return null;
                      const stationAgents = agents.filter((agent) => agent.stationId === station.id);
                      const stationTiles = buildStationProjectionTiles(filteredProjections, station.id);
                      return (
                        <StationCard
                          key={station.id}
                          station={station}
                          agents={stationAgents}
                          tiles={stationTiles}
                          selected={selected}
                          onSelect={onSelect}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <aside aria-label="Map inspector" className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Inspector</h3>
            {selectedStation ? <StationInspector station={selectedStation} agents={agents} projections={filteredProjections} onSelect={onSelect} /> : null}
            {selectedAgent ? <AgentInspector agent={selectedAgent} /> : null}
            {selectedProjection ? <ProjectionInspector projection={selectedProjection} /> : null}
          </aside>
        </div>
      </div>
    </details>
  );
}

function StationCard({
  station,
  agents,
  tiles,
  selected,
  onSelect,
}: {
  station: OperationsMapTemplate["stations"][number];
  agents: StationedOperationsMapAgent[];
  tiles: ReturnType<typeof buildStationProjectionTiles>;
  selected: SelectedItem;
  onSelect: (selected: SelectedItem) => void;
}) {
  const visibleTiles = tiles.slice(0, STATION_TILE_VISIBLE_LIMIT);
  const hiddenCount = tiles.length - visibleTiles.length;
  const selectedHere = selected.kind === "station" && selected.id === station.id;
  return (
    <div data-station-card={station.id} className={[
      "min-h-44 rounded-lg border p-3",
      selectedHere ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]" : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]",
    ].join(" ")}>
      <button type="button" aria-pressed={selectedHere} onClick={() => onSelect({ kind: "station", id: station.id })} className="min-h-11 w-full rounded text-left focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]">
        <h4 className="text-sm font-semibold text-[var(--dpf-text)]">{station.label}</h4>
        <p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--dpf-muted)]">{station.description}</p>
      </button>
      <div className="mt-2 flex flex-wrap gap-1">
        {agents.slice(0, 3).map((agent) => <span key={agent.agentId} className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)]">{agent.name}</span>)}
      </div>
      <div className="mt-3 space-y-1">
        {visibleTiles.map((tile) => (
          <button key={tile.projectionId} type="button" data-projection-tile aria-label={tile.accessibleLabel} onClick={() => onSelect({ kind: "projection", id: tile.projectionId })} className={["block min-h-11 w-full truncate rounded border px-2 py-2 text-left text-xs focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]", SEVERITY_CLASS[tile.severity]].join(" ")}>
            {tile.summary}
          </button>
        ))}
        {hiddenCount > 0 ? <button type="button" onClick={() => onSelect({ kind: "station", id: station.id })} className="min-h-11 w-full rounded border border-dashed border-[var(--dpf-border)] px-2 py-2 text-left text-xs text-[var(--dpf-muted)]">+{hiddenCount} more — open station</button> : null}
      </div>
    </div>
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
        <h4 className="font-semibold text-[var(--dpf-text)]">{station.label}</h4>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">{station.description}</p>
      </div>
      <InspectorList title="Coworkers">
        {stationAgents.length > 0 ? stationAgents.map((agent) => <InspectorButton key={agent.agentId} label={agent.name} onClick={() => onSelect({ kind: "agent", id: agent.agentId })} />) : <EmptyInspector text="No coworkers currently placed here." />}
      </InspectorList>
      <InspectorList title="Recent activity">
        {stationProjections.length > 0 ? stationProjections.map((projection) => <InspectorButton key={projection.id} label={projection.summary} onClick={() => onSelect({ kind: "projection", id: projection.id })} />) : <EmptyInspector text="No recent activity projected here." />}
      </InspectorList>
    </div>
  );
}

function AgentInspector({ agent }: { agent: StationedOperationsMapAgent }) {
  return (
    <div className="mt-4 space-y-3">
      <h4 className="font-semibold text-[var(--dpf-text)]">{agent.name}</h4>
      <p className="text-sm text-[var(--dpf-muted)]">{agent.description ?? "No description recorded."}</p>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <InspectorFact label="Station" value={agent.stationLabel} />
        <InspectorFact label="Tier" value={`Tier ${agent.tier}`} />
        <InspectorFact label="Skills" value={String(agent.counts.skills)} />
        <InspectorFact label="Tool grants" value={String(agent.counts.toolGrants)} />
      </dl>
      <Link href={`/platform/ai/agent/${encodeURIComponent(agent.agentId)}`} className="inline-flex min-h-11 items-center text-sm text-[var(--dpf-accent)] hover:underline">Open coworker detail</Link>
    </div>
  );
}

function ProjectionInspector({ projection }: { projection: OperationsMapProjection }) {
  const links = [
    projection.links.authorityHref ? { href: projection.links.authorityHref, label: "Open audit row" } : null,
    projection.links.historyHref ? { href: projection.links.historyHref, label: "Open history" } : null,
    projection.links.backlogHref ? { href: projection.links.backlogHref, label: "Open backlog item" } : null,
    projection.links.coworkerHref ? { href: projection.links.coworkerHref, label: "Open coworker" } : null,
  ].filter((item): item is { href: string; label: string } => item !== null);
  const stalled = projection.source === "task-run"
    && projection.refs.taskRunId != null
    && projection.summary.includes("(stalled)");
  return (
    <div className="mt-4 space-y-3">
      <h4 className="font-semibold text-[var(--dpf-text)]">{projection.label}</h4>
      <p className="text-sm text-[var(--dpf-muted)]">{projection.summary}</p>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <InspectorFact label="Source" value={SOURCE_LABEL[projection.source]} />
        <InspectorFact label="Severity" value={projection.severity} />
      </dl>
      {stalled && projection.refs.taskRunId ? <StalledTaskRecoveryActions taskRunId={projection.refs.taskRunId} phase={null} /> : null}
      <div className="flex flex-wrap gap-2">
        {links.map((item) => <Link key={item.href} href={item.href} className="inline-flex min-h-11 items-center text-sm text-[var(--dpf-accent)] hover:underline">{item.label}</Link>)}
      </div>
    </div>
  );
}

function DisclosureLabel() {
  return (
    <>
      <span className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs uppercase tracking-wide text-[var(--dpf-muted)] group-open:hidden">Open</span>
      <span className="hidden rounded border border-[var(--dpf-border)] px-2 py-1 text-xs uppercase tracking-wide text-[var(--dpf-muted)] group-open:inline-flex">Close</span>
    </>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{label}</p><div className="flex flex-wrap gap-2">{children}</div></div>;
}

function FilterButton({ active, label, title, onClick }: { active: boolean; label: string; title?: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} title={title} onClick={onClick} className={[
      "min-h-11 rounded border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
      active ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]" : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]",
    ].join(" ")}>{label}</button>
  );
}

function InspectorList({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{title}</p><div className="space-y-2">{children}</div></div>;
}

function InspectorButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-11 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-left text-xs text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]">{label}</button>;
}

function EmptyInspector({ text }: { text: string }) {
  return <p className="text-xs text-[var(--dpf-muted)]">{text}</p>;
}

function InspectorFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2"><dt className="text-xs text-[var(--dpf-muted)]">{label}</dt><dd className="mt-1 break-words font-medium text-[var(--dpf-text)]">{value}</dd></div>;
}

function toggleRequired<T extends string>(current: T[], option: T, allOptions: readonly T[]): T[] {
  if (current.includes(option)) {
    const next = current.filter((candidate) => candidate !== option);
    return next.length > 0 ? next : [...allOptions];
  }
  return allOptions.filter((candidate) => candidate === option || current.includes(candidate));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
