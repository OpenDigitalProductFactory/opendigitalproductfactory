// Unified Operations Topology canvas — one coworker spine, provider routes on
// the right, and A2A interactions on the left. This is the authoritative
// technical canvas; filters, replay, and table equivalence live in the adjacent
// OperationsTopologyControls rather than in duplicate diagram panels.
//
// Spec: docs/superpowers/specs/2026-06-05-ai-operations-map-three-band-cohesive-layout-design.md §7 Stage B

"use client";

import { useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { intentStyle } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import type { OperationsMapRoutingTopology } from "@/lib/ai-operations-map/types";
import {
  buildOperationsTopologyLayout,
  type TopologyViewport,
} from "./operations-topology-layout";
import {
  markerTypeStroke,
  ROUTE_STATE_LABEL,
  routeStateDash,
  routeStateOpacity,
  routeStateStroke,
  routeVisibleAtReplayTime,
  routeWidth,
} from "./operations-topology-style";
import {
  a2aEdgeVisibleAtReplayTime,
  a2aStateIntent,
  edgeKindDash,
  EDGE_KIND_LABEL,
  STATE_LABEL,
  type A2aReplayRange,
} from "./a2a-interaction-graph";

export type TopologyDimension = "provider" | "a2a" | "both";

type Props = {
  topology: OperationsMapRoutingTopology;
  viewport?: TopologyViewport;
  selectedCoworkerId?: string | null;
  /** Which halves to render — mirrors the Provider/A2A/Both dimension toggle. */
  dimension?: TopologyDimension;
  /** Shared replay playhead — when set, both halves scrub in lock-step. */
  replayTime?: number | null;
  replayRange?: A2aReplayRange | null;
};

const CANVAS = {
  width: 1040,
  spineX: 380,
  providerX: 880,
  nodeRadius: 8,
};

const ZOOM_LEVELS = [0.8, 1, 1.25, 1.5] as const;
const DEFAULT_ZOOM_INDEX = 1;

export function OperationsTopologyCanvas({
  topology,
  viewport = "desktop",
  selectedCoworkerId = null,
  dimension = "both",
  replayTime = null,
  replayRange = null,
}: Props) {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<
    { kind: "provider-route" | "a2a"; id: string } | null
  >(null);
  const zoomLevel = ZOOM_LEVELS[zoomIndex] ?? 1;
  const showProvider = dimension === "provider" || dimension === "both";
  const showA2a = dimension === "a2a" || dimension === "both";

  // Shared replay window: filter both halves by the playhead before layout so
  // the spine, routes, and arcs all reflect the same point in time. At the
  // default playhead (>= "current") everything recent stays visible.
  const replayActive = replayTime != null && replayRange != null;
  const visibleRoutes = showProvider
    ? (replayActive ? topology.routes.filter((route) => routeVisibleAtReplayTime(route, replayTime, replayRange)) : topology.routes)
    : [];
  const visibleA2aEdges = showA2a
    ? (replayActive ? topology.a2aEdges.filter((edge) => a2aEdgeVisibleAtReplayTime(edge.occurredAt, replayTime, replayRange)) : topology.a2aEdges)
    : [];

  // The spine is the union of the visible halves: provider-routing coworkers
  // and/or A2A participants. Each half is suppressed in single-dimension mode.
  const layout = buildOperationsTopologyLayout({
    coworkers: topology.coworkers,
    providers: showProvider ? topology.providers : [],
    routes: visibleRoutes,
    a2aEdges: visibleA2aEdges,
    markers: showProvider ? topology.markers : [],
    selectedCoworkerId,
    viewport,
  });

  const rowYById = new Map(layout.rows.map((row) => [row.coworkerId, row]));
  const providerYById = new Map(layout.providerNodes.map((node) => [node.providerId, node]));
  const routesById = new Map(topology.routes.map((route) => [route.id, route]));
  const a2aById = new Map(topology.a2aEdges.map((edge) => [edge.id, edge]));
  const coworkerLabelById = new Map(topology.coworkers.map((c) => [c.agentId, c.label]));
  const providerLabelById = new Map(topology.providers.map((p) => [p.providerId, p.label]));
  const selectedMarker = selectedMarkerId
    ? topology.markers.find((marker) => marker.id === selectedMarkerId) ?? null
    : null;
  const selectedRoute = selectedConnection?.kind === "provider-route"
    ? topology.routes.find((route) => route.id === selectedConnection.id) ?? null
    : null;
  const selectedA2a = selectedConnection?.kind === "a2a"
    ? topology.a2aEdges.find((edge) => edge.id === selectedConnection.id) ?? null
    : null;

  const isEmpty = layout.rows.length === 0 && layout.providerNodes.length === 0;
  const svgLabel = showProvider && showA2a
    ? "Coworker spine with A2A interactions and provider routing"
    : showA2a
      ? "Coworker spine with A2A interactions"
      : "Coworker spine with provider routing";

  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;

  return (
    <section
      aria-label="AI operations topology canvas"
      data-operations-topology-canvas
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        setSelectedMarkerId(null);
        setSelectedConnection(null);
      }}
      className="relative overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
    >
      {isEmpty ? (
        <p className="p-6 text-center text-sm text-[var(--dpf-muted)]">
          No provider routing or coworker activity in the current window.
        </p>
      ) : (
        <>
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--dpf-surface-1)_90%,transparent)] px-1.5 py-1 shadow-sm backdrop-blur">
          <ZoomButton label="Zoom out" icon={ZoomOut} disabled={!canZoomOut} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))} />
          <span className="min-w-10 text-center text-[11px] font-medium text-[var(--dpf-text)]">{Math.round(zoomLevel * 100)}%</span>
          <ZoomButton label="Zoom in" icon={ZoomIn} disabled={!canZoomIn} onClick={() => setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))} />
          <ZoomButton label="Reset zoom" icon={RotateCcw} disabled={zoomIndex === DEFAULT_ZOOM_INDEX} onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)} />
        </div>
        <svg
          viewBox={zoomedViewBox(CANVAS.width, layout.height, zoomLevel)}
          role="img"
          aria-label={svgLabel}
          className="h-full w-full"
          style={{ minHeight: 220 }}
        >
          <defs>
            <marker id="topology-route-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--dpf-muted)" />
            </marker>
          </defs>

          {showA2a ? (
            <text x={CANVAS.spineX - 230} y="22" textAnchor="middle" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
              Coworker interactions
            </text>
          ) : null}
          <text x={CANVAS.spineX} y="22" textAnchor="middle" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
            Coworkers
          </text>
          {showProvider ? (
            <text x={CANVAS.providerX} y="22" textAnchor="middle" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
              Providers
            </text>
          ) : null}

          {/* A2A interaction arcs (left of the spine), coworker → coworker */}
          {showA2a
            ? layout.a2aArcs.map((arc) => {
                const fromRow = rowYById.get(arc.fromCoworkerId);
                const toRow = rowYById.get(arc.toCoworkerId);
                if (!fromRow || !toRow) return null;
                const edge = a2aById.get(arc.edgeId);
                const stroke = intentStyle(a2aStateIntent(arc.state)).fg;
                return (
                  <path
                    key={arc.edgeId}
                    data-canvas-a2a-arc={arc.edgeId}
                    data-a2a-kind={arc.edgeKind}
                    data-a2a-state={arc.state}
                    role="button"
                    tabIndex={0}
                    aria-label={`${fromRow.label} → ${toRow.label}: ${EDGE_KIND_LABEL[arc.edgeKind]} (${STATE_LABEL[arc.state]})`}
                    onClick={() => {
                      setSelectedMarkerId(null);
                      setSelectedConnection({ kind: "a2a", id: arc.edgeId });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedMarkerId(null);
                      setSelectedConnection({ kind: "a2a", id: arc.edgeId });
                    }}
                    d={a2aArcPath(CANVAS.spineX, arc.fromY, arc.toY, arc.lane)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={Math.min(4, 1.2 + (edge?.weight ?? 1) * 0.4)}
                    strokeDasharray={edgeKindDash(arc.edgeKind)}
                    strokeOpacity="0.9"
                    strokeLinecap="round"
                    markerEnd="url(#topology-route-arrow)"
                  >
                    <title>{`${fromRow.label} → ${toRow.label}: ${edge?.label ?? EDGE_KIND_LABEL[arc.edgeKind]}`}</title>
                  </path>
                );
              })
            : null}

          {/* Provider routes: spine row → provider node */}
          {showProvider ? layout.routeLanes.map((lane) => {
            const row = rowYById.get(lane.coworkerId);
            const provider = providerYById.get(lane.providerId);
            if (!row || !provider) return null;
            const route = routesById.get(lane.routeId);
            const stroke = routeStateStroke(lane.state);
            return (
              <path
                key={lane.routeId}
                data-canvas-route={lane.routeId}
                data-route-state={lane.state}
                role="button"
                tabIndex={0}
                aria-label={`${row.label} → ${provider.label}: ${ROUTE_STATE_LABEL[lane.state]}`}
                onClick={() => {
                  setSelectedMarkerId(null);
                  setSelectedConnection({ kind: "provider-route", id: lane.routeId });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelectedMarkerId(null);
                  setSelectedConnection({ kind: "provider-route", id: lane.routeId });
                }}
                d={routePath(CANVAS.spineX, lane.fromY, CANVAS.providerX, provider.y, lane.lane)}
                fill="none"
                stroke={stroke}
                strokeWidth={routeWidth(route?.trafficWeight ?? 1)}
                strokeDasharray={routeStateDash(lane.state)}
                strokeOpacity={routeStateOpacity(lane.state)}
                strokeLinecap="round"
                markerEnd="url(#topology-route-arrow)"
              >
                <title>{`${row.label} → ${provider.label}: ${ROUTE_STATE_LABEL[lane.state]}`}</title>
              </path>
            );
          }) : null}

          {/* Markers (decision/error/etc.) — route-attached at midpoint, provider-side near the provider */}
          {showProvider ? topology.markers.map((marker) => {
            const anchor = markerAnchor(marker, layout, rowYById, providerYById);
            if (!anchor) return null;
            const isSelected = marker.id === selectedMarkerId;
            return (
              <g
                key={marker.id}
                data-canvas-marker={marker.id}
                data-marker-type={marker.type}
                data-marker-selected={isSelected ? "true" : "false"}
                role="button"
                tabIndex={0}
                aria-label={`${marker.label}: ${marker.summary}`}
                className="cursor-pointer focus:outline-none"
                onClick={() => {
                  setSelectedConnection(null);
                  setSelectedMarkerId(marker.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedConnection(null);
                    setSelectedMarkerId(marker.id);
                  }
                }}
              >
                <title>{`${marker.label}: ${marker.summary}`}</title>
                <circle cx={anchor.x} cy={anchor.y} r={isSelected ? 7 : 5} fill="var(--dpf-surface-1)" stroke={markerTypeStroke(marker.type)} strokeWidth={isSelected ? 3 : 2} />
              </g>
            );
          }) : null}

          {/* Coworker spine */}
          {layout.rows.map((row) => (
            <g key={row.coworkerId} data-canvas-coworker-row={row.coworkerId} data-row-selected={row.selected ? "true" : "false"}>
              <circle cx={CANVAS.spineX} cy={row.y} r={CANVAS.nodeRadius} fill="var(--dpf-surface-1)" stroke="var(--dpf-accent)" strokeWidth="2.4" />
              <circle cx={CANVAS.spineX} cy={row.y} r="3" fill="var(--dpf-accent)" />
              <text x={CANVAS.spineX - CANVAS.nodeRadius - 8} y={row.y + 3.5} textAnchor="end" className="fill-[var(--dpf-text)] text-[10px] font-semibold">
                {clip(row.label, 28)}
              </text>
            </g>
          ))}

          {/* Provider nodes */}
          {layout.providerNodes.map((node) => (
            <g key={node.providerId} data-canvas-provider={node.providerId}>
              <circle cx={CANVAS.providerX} cy={node.y} r={CANVAS.nodeRadius} fill="var(--dpf-surface-1)" stroke="var(--dpf-muted)" strokeWidth="2.2" />
              <text x={CANVAS.providerX + CANVAS.nodeRadius + 8} y={node.y + 3.5} textAnchor="start" className="fill-[var(--dpf-text)] text-[10px] font-semibold">
                {clip(node.label, 28)}
              </text>
            </g>
          ))}
        </svg>
        {selectedMarker ? (
          <aside
            data-canvas-marker-detail={selectedMarker.id}
            aria-label="Marker detail"
            className="absolute bottom-2 left-2 z-10 max-w-xs rounded-md border border-[var(--dpf-border)] bg-[color-mix(in_srgb,var(--dpf-surface-1)_94%,transparent)] p-3 text-xs shadow-lg backdrop-blur"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-[var(--dpf-text)]" style={{ color: markerTypeStroke(selectedMarker.type) }}>
                {selectedMarker.label}
              </p>
              <button
                type="button"
                aria-label="Close marker detail"
                onClick={() => setSelectedMarkerId(null)}
                className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 leading-5 text-[var(--dpf-muted)]">{selectedMarker.summary}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
              <dt className="font-semibold text-[var(--dpf-muted)]">When</dt>
              <dd className="min-w-0 break-words text-[var(--dpf-text)]">
                <LocalTime value={selectedMarker.occurredAt} fallback="Current state" />
              </dd>
              <dt className="font-semibold text-[var(--dpf-muted)]">Coworker</dt>
              <dd className="min-w-0 break-words text-[var(--dpf-text)]">
                {selectedMarker.coworkerId
                  ? coworkerLabelById.get(selectedMarker.coworkerId) ?? selectedMarker.coworkerId
                  : "Not recorded"}
              </dd>
              <dt className="font-semibold text-[var(--dpf-muted)]">Provider</dt>
              <dd className="min-w-0 break-words text-[var(--dpf-text)]">
                {selectedMarker.providerId
                  ? providerLabelById.get(selectedMarker.providerId) ?? selectedMarker.providerId
                  : "Not provider-specific"}
              </dd>
            </dl>
          </aside>
        ) : null}
        {selectedRoute || selectedA2a ? (
          <aside
            data-canvas-connection-detail
            aria-label="Connection detail"
            className="absolute bottom-2 left-2 z-10 max-w-sm rounded-md border border-[var(--dpf-border)] bg-[color-mix(in_srgb,var(--dpf-surface-1)_94%,transparent)] p-3 text-xs shadow-lg backdrop-blur"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-[var(--dpf-text)]">
                {selectedRoute ? "Provider route" : "A2A interaction"}
              </p>
              <button
                type="button"
                aria-label="Close connection detail"
                onClick={() => setSelectedConnection(null)}
                className="min-h-11 min-w-11 rounded text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
              >
                Close
              </button>
            </div>
            {selectedRoute ? (
              <>
                <p className="mt-1 leading-5 text-[var(--dpf-muted)]">{selectedRoute.summary}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                  <dt className="font-semibold text-[var(--dpf-muted)]">From</dt>
                  <dd>{coworkerLabelById.get(selectedRoute.coworkerId) ?? selectedRoute.coworkerId}</dd>
                  <dt className="font-semibold text-[var(--dpf-muted)]">To</dt>
                  <dd>{providerLabelById.get(selectedRoute.providerId) ?? selectedRoute.providerId}</dd>
                  <dt className="font-semibold text-[var(--dpf-muted)]">State</dt>
                  <dd>{ROUTE_STATE_LABEL[selectedRoute.state]}</dd>
                  <dt className="font-semibold text-[var(--dpf-muted)]">When</dt>
                  <dd><LocalTime value={selectedRoute.occurredAt} fallback="Current state" /></dd>
                  <dt className="font-semibold text-[var(--dpf-muted)]">Source</dt>
                  <dd className="break-all">{selectedRoute.decisionId ?? selectedRoute.id}</dd>
                </dl>
              </>
            ) : null}
            {selectedA2a ? (
              <>
                <p className="mt-1 leading-5 text-[var(--dpf-muted)]">{selectedA2a.summary}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                  <dt className="font-semibold text-[var(--dpf-muted)]">From</dt>
                  <dd>{coworkerLabelById.get(selectedA2a.fromCoworkerId) ?? selectedA2a.fromCoworkerId}</dd>
                  <dt className="font-semibold text-[var(--dpf-muted)]">To</dt>
                  <dd>{coworkerLabelById.get(selectedA2a.toCoworkerId) ?? selectedA2a.toCoworkerId}</dd>
                  <dt className="font-semibold text-[var(--dpf-muted)]">State</dt>
                  <dd>{STATE_LABEL[selectedA2a.state]}</dd>
                  <dt className="font-semibold text-[var(--dpf-muted)]">Authority</dt>
                  <dd>{selectedA2a.authorityScope?.join(", ") || "Not recorded"}</dd>
                  <dt className="font-semibold text-[var(--dpf-muted)]">Source</dt>
                  <dd className="break-all">{a2aSourceRef(selectedA2a)}</dd>
                </dl>
              </>
            ) : null}
          </aside>
        ) : null}
        </>
      )}
    </section>
  );
}

function ZoomButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof ZoomIn;
  disabled?: boolean;
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
        "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
        disabled
          ? "cursor-not-allowed text-[var(--dpf-muted)] opacity-50"
          : "text-[var(--dpf-text)] hover:bg-[var(--dpf-accent-soft)]",
      ].join(" ")}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  );
}

function zoomedViewBox(width: number, height: number, zoom: number): string {
  const w = width / zoom;
  const h = height / zoom;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  return `${x} ${y} ${w} ${h}`;
}

function routePath(fromX: number, fromY: number, toX: number, toY: number, lane: number): string {
  const midX = (fromX + toX) / 2;
  const bend = (lane % 2 === 0 ? 1 : -1) * Math.min(40, 12 + lane * 10);
  return `M ${fromX + 10} ${fromY} C ${midX} ${fromY + bend}, ${midX} ${toY - bend}, ${toX - 10} ${toY}`;
}

// Left-bulging arc between two spine rows (coworker → coworker). Both endpoints
// sit on the spine; the curve bulges into the A2A interaction space on the left.
function a2aArcPath(spineX: number, fromY: number, toY: number, lane: number): string {
  const r = CANVAS.nodeRadius;
  const bulge = 60 + lane * 28 + Math.abs(toY - fromY) * 0.12;
  const cx = spineX - bulge;
  return `M ${spineX - r} ${fromY} C ${cx} ${fromY}, ${cx} ${toY}, ${spineX - r} ${toY}`;
}

function markerAnchor(
  marker: OperationsMapRoutingTopology["markers"][number],
  layout: ReturnType<typeof buildOperationsTopologyLayout>,
  rowYById: Map<string, ReturnType<typeof buildOperationsTopologyLayout>["rows"][number]>,
  providerYById: Map<string, ReturnType<typeof buildOperationsTopologyLayout>["providerNodes"][number]>,
): { x: number; y: number } | null {
  // Route-attached marker → midpoint of its route.
  if (marker.routeId) {
    const lane = layout.routeLanes.find((l) => l.routeId === marker.routeId);
    if (lane) {
      const provider = providerYById.get(lane.providerId);
      const row = rowYById.get(lane.coworkerId);
      if (provider && row) return { x: (CANVAS.spineX + CANVAS.providerX) / 2, y: (lane.fromY + provider.y) / 2 };
    }
  }
  // Provider-side marker (e.g. unattributed router audit, no coworker) → near its provider.
  if (marker.providerId) {
    const provider = providerYById.get(marker.providerId);
    if (provider) return { x: CANVAS.providerX - 28, y: provider.y };
  }
  return null;
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function a2aSourceRef(edge: OperationsMapRoutingTopology["a2aEdges"][number]): string {
  return edge.refs.delegationChainId
    ?? edge.refs.phaseHandoffId
    ?? edge.refs.taskRunId
    ?? edge.refs.parentTaskRunId
    ?? edge.refs.deliberationRunId
    ?? edge.id;
}
