"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  DataTable,
  StatCard,
  StatusBadge,
  type Column,
  type Intent,
} from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import type {
  OperationsMapA2aEdgeKind,
  OperationsMapA2aInteractionState,
  OperationsMapRoutingRouteState,
  OperationsMapRoutingTopology,
} from "@/lib/ai-operations-map/types";
import {
  A2A_EDGE_KINDS,
  A2A_STATES,
  EDGE_KIND_LABEL,
  STATE_LABEL,
  a2aEdgeVisibleAtReplayTime,
} from "./a2a-interaction-graph";
import {
  clearA2aFilterPreference,
  getDefaultA2aFilterPreference,
  loadA2aFilterPreference,
  saveA2aFilterPreference,
  type A2aActorRole,
  type A2aAuthorityFilter,
  type OperationsMapDimension,
} from "./ai-operations-map-prefs";
import {
  applyA2aControlFilters,
  applyRoutingControlFilters,
  providerMatchesTypeFilter,
  type A2aControlCriteria,
  type RoutingControlCriteria,
  type RoutingProviderTypeFilter,
  type RoutingRouteFilter,
} from "./operations-control-filters";
import { routeVisibleAtReplayTime } from "./operations-topology-style";

export type OperationsTopologyReplayRange = {
  start: number;
  current: number;
  end: number;
};

type EvidenceRange = {
  earliest: string | null;
  latest: string | null;
};

type Props = {
  topology: OperationsMapRoutingTopology;
  dimension: OperationsMapDimension;
  evidenceRange?: EvidenceRange | null;
  onRoutingChange: (criteria: RoutingControlCriteria) => void;
  onA2aChange: (criteria: A2aControlCriteria) => void;
  onReplayChange: (selectedTime: number, range: OperationsTopologyReplayRange) => void;
};

const ROUTE_FILTER_OPTIONS: Array<{ value: RoutingRouteFilter; label: string }> = [
  { value: "all", label: "All routes" },
  { value: "active", label: "Active" },
  { value: "secondary", label: "Secondary" },
  { value: "failover", label: "Failover" },
  { value: "scheduled", label: "Scheduled" },
  { value: "historical", label: "Historical" },
];

const PROVIDER_TYPE_OPTIONS: Array<{ value: RoutingProviderTypeFilter; label: string }> = [
  { value: "llm", label: "LLM providers" },
  { value: "mcp", label: "MCP servers" },
  { value: "all", label: "All provider types" },
];

const AUTHORITY_OPTIONS: Array<{ value: A2aAuthorityFilter; label: string }> = [
  { value: "all", label: "All authority" },
  { value: "governed", label: "Governed" },
  { value: "ungoverned", label: "Authority gap" },
];

const REPLAY_ZOOM_LEVELS = [1, 2, 4, 8, 16] as const;

type TopologyLedgerRow = {
  id: string;
  kind: "provider-route" | "a2a";
  from: string;
  to: string;
  state: string;
  summary: string;
  occurredAt: string | null;
  source: string;
  authority: string;
};

export function OperationsTopologyControls({
  topology,
  dimension,
  evidenceRange = null,
  onRoutingChange,
  onA2aChange,
  onReplayChange,
}: Props) {
  const defaults = getDefaultA2aFilterPreference();
  const [routing, setRouting] = useState<RoutingControlCriteria>({
    routeFilter: "all",
    providerTypeFilter: "llm",
    providerFilter: "all",
  });
  const [a2a, setA2a] = useState<A2aControlCriteria>(defaults);
  const [replayPercent, setReplayPercent] = useState<number | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [a2aHydrated, setA2aHydrated] = useState(false);

  const baseRange = useMemo(
    () => buildReplayRange(topology, evidenceRange),
    [evidenceRange, topology],
  );
  const selectedTime = timestampFromPercent(baseRange, replayPercent ?? percentForTimestamp(baseRange, baseRange.current));
  const replayRange = useMemo(
    () => buildReplayWindow(baseRange, selectedTime, REPLAY_ZOOM_LEVELS[zoomIndex] ?? 1),
    [baseRange, selectedTime, zoomIndex],
  );
  const displayedPercent = percentForTimestamp(replayRange, selectedTime);

  useEffect(() => {
    setA2a(loadA2aFilterPreference());
    setA2aHydrated(true);
  }, []);

  useEffect(() => {
    if (!a2aHydrated) return;
    saveA2aFilterPreference(a2a);
  }, [a2a, a2aHydrated]);

  useEffect(() => onRoutingChange(routing), [onRoutingChange, routing]);
  useEffect(() => onA2aChange(a2a), [a2a, onA2aChange]);
  useEffect(
    () => onReplayChange(selectedTime, replayRange),
    [onReplayChange, replayRange, selectedTime],
  );

  const providerOptions = useMemo(
    () => topology.providers.filter((provider) => providerMatchesTypeFilter(provider, routing.providerTypeFilter)),
    [routing.providerTypeFilter, topology.providers],
  );
  const participantOptions = useMemo(() => {
    const participantIds = new Set(topology.a2aEdges.flatMap((edge) => [edge.fromCoworkerId, edge.toCoworkerId]));
    const labels = new Map(topology.coworkers.map((coworker) => [coworker.agentId, coworker.label]));
    return [...participantIds]
      .map((id) => ({ id, label: labels.get(id) ?? id }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [topology.a2aEdges, topology.coworkers]);

  const filteredTopology = useMemo(() => {
    const provider = applyRoutingControlFilters(topology, routing);
    const a2aEdges = applyA2aControlFilters(topology.a2aEdges, a2a);
    return {
      routes: provider.routes.filter((route) => routeVisibleAtReplayTime(route, selectedTime, replayRange)),
      providers: provider.providers,
      markers: provider.markers,
      a2aEdges: a2aEdges.filter((edge) => a2aEdgeVisibleAtReplayTime(edge.occurredAt, selectedTime, replayRange)),
    };
  }, [a2a, replayRange, routing, selectedTime, topology]);

  const showProvider = dimension === "provider" || dimension === "both";
  const showA2a = dimension === "a2a" || dimension === "both";
  const ledgerRows = useMemo(
    () => buildLedgerRows(topology, filteredTopology, showProvider, showA2a),
    [filteredTopology, showA2a, showProvider, topology],
  );
  const failedA2a = filteredTopology.a2aEdges.filter((edge) => edge.state === "failed").length;
  const failoverRoutes = filteredTopology.routes.filter((route) => route.state === "failover").length;

  const resetControls = () => {
    const nextA2a = getDefaultA2aFilterPreference();
    setRouting({ routeFilter: "all", providerTypeFilter: "llm", providerFilter: "all" });
    setA2a(nextA2a);
    setReplayPercent(null);
    setZoomIndex(0);
    clearA2aFilterPreference();
  };

  return (
    <section
      aria-label="Technical topology controls"
      className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">View and replay</h3>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Filter the one topology below. Controls never change routing or send coworker work.
          </p>
        </div>
        <button
          type="button"
          onClick={resetControls}
          className="min-h-11 rounded border border-[var(--dpf-border)] px-3 py-2 text-xs font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
        >
          Reset topology view
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Visible records" value={ledgerRows.length} intent="accent" />
        <StatCard label="Provider routes" value={showProvider ? filteredTopology.routes.length : 0} />
        <StatCard label="Failover routes" value={showProvider ? failoverRoutes : 0} intent={failoverRoutes > 0 ? "warning" : "neutral"} />
        <StatCard label="Failed A2A" value={showA2a ? failedA2a : 0} intent={failedA2a > 0 ? "danger" : "neutral"} />
      </div>

      {showProvider ? (
        <fieldset className="grid gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 md:grid-cols-3">
          <legend className="px-1 text-xs font-semibold text-[var(--dpf-text)]">Provider routes</legend>
          <SelectControl
            label="Route filter"
            value={routing.routeFilter}
            options={ROUTE_FILTER_OPTIONS}
            onChange={(value) => setRouting((current) => ({ ...current, routeFilter: value as RoutingRouteFilter }))}
          />
          <SelectControl
            label="Provider type"
            value={routing.providerTypeFilter}
            options={PROVIDER_TYPE_OPTIONS}
            onChange={(value) => setRouting((current) => ({
              ...current,
              providerTypeFilter: value as RoutingProviderTypeFilter,
              providerFilter: "all",
            }))}
          />
          <SelectControl
            label="Provider filter"
            value={routing.providerFilter}
            options={[
              { value: "all", label: "All providers" },
              ...providerOptions.map((provider) => ({ value: provider.providerId, label: provider.label })),
            ]}
            onChange={(value) => setRouting((current) => ({ ...current, providerFilter: value }))}
          />
        </fieldset>
      ) : null}

      {showA2a ? (
        <fieldset className="space-y-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <legend className="px-1 text-xs font-semibold text-[var(--dpf-text)]">Coworker interactions</legend>
          <div className="flex flex-wrap gap-2">
            {A2A_EDGE_KINDS.map((kind) => (
              <ToggleChip
                key={kind}
                label={`A2A ${EDGE_KIND_LABEL[kind].toLowerCase()}`}
                active={a2a.types.includes(kind)}
                onClick={() => setA2a((current) => ({
                  ...current,
                  types: toggleRequired(current.types, kind, A2A_EDGE_KINDS),
                }))}
              />
            ))}
            {A2A_STATES.map((state) => (
              <ToggleChip
                key={state}
                label={`A2A state ${STATE_LABEL[state].toLowerCase()}`}
                active={a2a.states.includes(state)}
                onClick={() => setA2a((current) => ({
                  ...current,
                  states: toggleRequired(current.states, state, A2A_STATES),
                }))}
              />
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <SelectControl
              label="A2A authority"
              value={a2a.authority}
              options={AUTHORITY_OPTIONS}
              onChange={(value) => setA2a((current) => ({ ...current, authority: value as A2aAuthorityFilter }))}
            />
            <SelectControl
              label="A2A coworker"
              value={a2a.actorId}
              options={[
                { value: "all", label: "All coworkers" },
                ...participantOptions.map((participant) => ({ value: participant.id, label: participant.label })),
              ]}
              onChange={(value) => setA2a((current) => ({ ...current, actorId: value }))}
            />
            <SelectControl
              label="A2A coworker role"
              value={a2a.actorRole}
              disabled={a2a.actorId === "all"}
              options={[
                { value: "either", label: "Source or target" },
                { value: "from", label: "Source" },
                { value: "to", label: "Target" },
              ]}
              onChange={(value) => setA2a((current) => ({ ...current, actorRole: value as A2aActorRole }))}
            />
          </div>
        </fieldset>
      ) : null}

      <ReplayControl
        topology={topology}
        range={replayRange}
        selectedTime={selectedTime}
        value={displayedPercent}
        zoomIndex={zoomIndex}
        onChange={(percent) => setReplayPercent(percentForTimestamp(baseRange, timestampFromPercent(replayRange, percent)))}
        onZoomChange={setZoomIndex}
      />

      <details className="group rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]">
          <span className="text-xs font-semibold text-[var(--dpf-text)]">List and evidence table</span>
          <span className="text-xs text-[var(--dpf-muted)]">{ledgerRows.length} visible</span>
        </summary>
        <div data-operations-topology-ledger className="overflow-x-auto border-t border-[var(--dpf-border)] p-3">
          <DataTable
            columns={ledgerColumns}
            rows={ledgerRows}
            getRowKey={(row) => row.id}
            initialSort={{ key: "when", dir: "desc" }}
            dense
            empty="No topology evidence matches the current filters and replay window."
          />
        </div>
      </details>
    </section>
  );
}

function ReplayControl({
  topology,
  range,
  selectedTime,
  value,
  zoomIndex,
  onChange,
  onZoomChange,
}: {
  topology: OperationsMapRoutingTopology;
  range: OperationsTopologyReplayRange;
  selectedTime: number;
  value: number;
  zoomIndex: number;
  onChange: (value: number) => void;
  onZoomChange: (index: number) => void;
}) {
  const markerCount = topology.timeline.filter((marker) => {
    const timestamp = parseTimestamp(marker.occurredAt);
    return timestamp !== null && timestamp >= range.start && timestamp <= range.end;
  }).length;
  return (
    <div aria-label="Routing replay timeline" className="space-y-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[var(--dpf-text)]">Replay history and forecast</p>
          <p className="text-xs text-[var(--dpf-muted)]">{markerCount} evidence markers in this scale</p>
        </div>
        <div className="flex items-center gap-1">
          <ReplayButton label="Zoom time scale out" icon={ZoomOut} disabled={zoomIndex === 0} onClick={() => onZoomChange(Math.max(0, zoomIndex - 1))} />
          <span className="min-w-12 text-center text-xs text-[var(--dpf-text)]">{REPLAY_ZOOM_LEVELS[zoomIndex]}x</span>
          <ReplayButton label="Zoom time scale in" icon={ZoomIn} disabled={zoomIndex === REPLAY_ZOOM_LEVELS.length - 1} onClick={() => onZoomChange(Math.min(REPLAY_ZOOM_LEVELS.length - 1, zoomIndex + 1))} />
          <ReplayButton label="Reset time scale" icon={RotateCcw} disabled={zoomIndex === 0} onClick={() => onZoomChange(0)} />
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value)}
        aria-label="Routing replay cursor"
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--dpf-accent)]"
      />
      <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--dpf-muted)]">
        <LocalTime value={new Date(range.start)} fallback="History" />
        <span className="font-semibold text-[var(--dpf-text)]">
          Viewing <LocalTime value={new Date(selectedTime)} fallback="Current state" />
        </span>
        <LocalTime value={new Date(range.end)} fallback="Forecast" />
      </div>
    </div>
  );
}

function SelectControl({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={["flex min-w-0 flex-col gap-1 text-xs", disabled ? "opacity-50" : ""].join(" ")}>
      <span className="font-medium text-[var(--dpf-muted)]">{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-2 text-xs text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={[
        "min-h-11 rounded-full border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
        active
          ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
          : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ReplayButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof ZoomIn;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 w-11 items-center justify-center rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

const ledgerColumns: Column<TopologyLedgerRow>[] = [
  {
    key: "kind",
    header: "Connection",
    cell: (row) => row.kind === "provider-route" ? "Provider route" : "A2A",
    sortAccessor: (row) => row.kind,
  },
  {
    key: "path",
    header: "From → to",
    cell: (row) => <span>{row.from} → {row.to}</span>,
    sortAccessor: (row) => `${row.from}:${row.to}`,
  },
  {
    key: "state",
    header: "State",
    cell: (row) => <StatusBadge intent={stateIntent(row.state)} label={humanize(row.state)} />,
    sortAccessor: (row) => row.state,
  },
  {
    key: "when",
    header: "When",
    cell: (row) => <LocalTime value={row.occurredAt} fallback="Current state" />,
    sortAccessor: (row) => parseTimestamp(row.occurredAt) ?? 0,
  },
  {
    key: "evidence",
    header: "Evidence",
    cell: (row) => (
      <div className="max-w-md">
        <p className="text-[var(--dpf-text)]">{row.summary}</p>
        <p className="mt-1 text-[var(--dpf-muted)]">Authority: {row.authority} · Source: {row.source}</p>
      </div>
    ),
  },
];

function buildLedgerRows(
  topology: OperationsMapRoutingTopology,
  filtered: {
    routes: OperationsMapRoutingTopology["routes"];
    a2aEdges: OperationsMapRoutingTopology["a2aEdges"];
  },
  showProvider: boolean,
  showA2a: boolean,
): TopologyLedgerRow[] {
  const coworkerLabels = new Map(topology.coworkers.map((coworker) => [coworker.agentId, coworker.label]));
  const providerLabels = new Map(topology.providers.map((provider) => [provider.providerId, provider.label]));
  const providerRows = showProvider ? filtered.routes.map((route): TopologyLedgerRow => ({
    id: `route:${route.id}`,
    kind: "provider-route",
    from: coworkerLabels.get(route.coworkerId) ?? route.coworkerId,
    to: providerLabels.get(route.providerId) ?? route.providerId,
    state: route.state,
    summary: route.summary,
    occurredAt: route.occurredAt,
    source: route.decisionId ?? route.id,
    authority: "Routing policy and provider eligibility",
  })) : [];
  const a2aRows = showA2a ? filtered.a2aEdges.map((edge): TopologyLedgerRow => ({
    id: `a2a:${edge.id}`,
    kind: "a2a",
    from: coworkerLabels.get(edge.fromCoworkerId) ?? edge.fromCoworkerId,
    to: coworkerLabels.get(edge.toCoworkerId) ?? edge.toCoworkerId,
    state: edge.state,
    summary: edge.summary,
    occurredAt: edge.occurredAt,
    source: edge.refs.delegationChainId
      ?? edge.refs.phaseHandoffId
      ?? edge.refs.taskRunId
      ?? edge.refs.deliberationRunId
      ?? edge.id,
    authority: edge.authorityScope?.join(", ") || "Not recorded",
  })) : [];
  return [...providerRows, ...a2aRows];
}

function buildReplayRange(
  topology: OperationsMapRoutingTopology,
  evidenceRange: EvidenceRange | null,
): OperationsTopologyReplayRange {
  const current = Date.now();
  const timestamps = [
    evidenceRange?.earliest,
    evidenceRange?.latest,
    ...topology.routes.map((route) => route.occurredAt),
    ...topology.a2aEdges.map((edge) => edge.occurredAt),
    ...topology.markers.map((marker) => marker.occurredAt),
    ...topology.timeline.map((marker) => marker.occurredAt),
  ].map(parseTimestamp).filter((value): value is number => value !== null);
  const start = timestamps.length > 0 ? Math.min(...timestamps, current) : current - 24 * 60 * 60 * 1000;
  const end = timestamps.length > 0 ? Math.max(...timestamps, current) : current + 6 * 60 * 60 * 1000;
  return { start, current, end: Math.max(end, start + 60_000) };
}

function buildReplayWindow(
  base: OperationsTopologyReplayRange,
  center: number,
  zoom: number,
): OperationsTopologyReplayRange {
  if (zoom <= 1) return base;
  const span = Math.max(60_000, (base.end - base.start) / zoom);
  const start = Math.max(base.start, Math.min(center - span / 2, base.end - span));
  return {
    start,
    current: Math.max(start, Math.min(base.current, start + span)),
    end: start + span,
  };
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function percentForTimestamp(range: Pick<OperationsTopologyReplayRange, "start" | "end">, timestamp: number): number {
  if (range.end <= range.start) return 100;
  return Math.max(0, Math.min(100, ((timestamp - range.start) / (range.end - range.start)) * 100));
}

function timestampFromPercent(range: Pick<OperationsTopologyReplayRange, "start" | "end">, percent: number): number {
  return range.start + (range.end - range.start) * (Math.max(0, Math.min(100, percent)) / 100);
}

function toggleRequired<T extends string>(current: T[], value: T, all: readonly T[]): T[] {
  if (current.includes(value)) {
    const next = current.filter((candidate) => candidate !== value);
    return next.length > 0 ? next : [...all];
  }
  return all.filter((candidate) => candidate === value || current.includes(candidate));
}

function stateIntent(state: string): Intent {
  if (state === "active" || state === "completed") return "success";
  if (state === "failed") return "danger";
  if (state === "blocked" || state === "failover") return "warning";
  if (state === "scheduled") return "info";
  return "neutral";
}

function humanize(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
