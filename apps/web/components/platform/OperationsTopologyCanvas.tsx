// Unified Operations Topology canvas — one coworker spine, provider routes on
// the right, A2A interactions on the left. Stage B1 renders ONLY the provider
// side (spine + provider nodes + routes + markers) so the new canvas can prove
// provider parity against the old RoutingTopologyPanel before the A2A arc half
// (Stage C) and the interactive replay/zoom/popover reuse (Stage B2) land.
//
// This component is intentionally NOT wired into the operator route yet; it is
// exercised only by parity tests until Stage E cutover.
//
// Spec: docs/superpowers/specs/2026-06-05-ai-operations-map-three-band-cohesive-layout-design.md §7 Stage B

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
  routeWidth,
} from "./operations-topology-style";

type Props = {
  topology: OperationsMapRoutingTopology;
  viewport?: TopologyViewport;
  selectedCoworkerId?: string | null;
};

const CANVAS = {
  width: 1040,
  spineX: 380,
  providerX: 880,
  nodeRadius: 8,
};

export function OperationsTopologyCanvas({ topology, viewport = "desktop", selectedCoworkerId = null }: Props) {
  // Provider-only mode for B1: pass no A2A edges so the spine is the union of
  // routing coworkers (the left arc half arrives in Stage C).
  const layout = buildOperationsTopologyLayout({
    coworkers: topology.coworkers,
    providers: topology.providers,
    routes: topology.routes,
    a2aEdges: [],
    markers: topology.markers,
    selectedCoworkerId,
    viewport,
  });

  const rowYById = new Map(layout.rows.map((row) => [row.coworkerId, row]));
  const providerYById = new Map(layout.providerNodes.map((node) => [node.providerId, node]));
  const routesById = new Map(topology.routes.map((route) => [route.id, route]));

  const isEmpty = layout.rows.length === 0 && layout.providerNodes.length === 0;

  return (
    <section
      aria-label="AI operations topology canvas"
      data-operations-topology-canvas
      className="overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
    >
      {isEmpty ? (
        <p className="p-6 text-center text-sm text-[var(--dpf-muted)]">
          No provider routing or coworker activity in the current window.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${CANVAS.width} ${layout.height}`}
          role="img"
          aria-label="Coworker spine with provider routing"
          className="h-full w-full"
          style={{ minHeight: 220 }}
        >
          <defs>
            <marker id="topology-route-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--dpf-muted)" />
            </marker>
          </defs>

          <text x={CANVAS.spineX} y="22" textAnchor="middle" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
            Coworkers
          </text>
          <text x={CANVAS.providerX} y="22" textAnchor="middle" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
            Providers
          </text>

          {/* Provider routes: spine row → provider node */}
          {layout.routeLanes.map((lane) => {
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
          })}

          {/* Markers (decision/error/etc.) — route-attached at midpoint, provider-side near the provider */}
          {topology.markers.map((marker) => {
            const anchor = markerAnchor(marker, layout, rowYById, providerYById);
            if (!anchor) return null;
            return (
              <g key={marker.id} data-canvas-marker={marker.id} data-marker-type={marker.type}>
                <title>{`${marker.label}: ${marker.summary}`}</title>
                <circle cx={anchor.x} cy={anchor.y} r="5" fill="var(--dpf-surface-1)" stroke={markerTypeStroke(marker.type)} strokeWidth="2" />
              </g>
            );
          })}

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
      )}
    </section>
  );
}

function routePath(fromX: number, fromY: number, toX: number, toY: number, lane: number): string {
  const midX = (fromX + toX) / 2;
  const bend = (lane % 2 === 0 ? 1 : -1) * Math.min(40, 12 + lane * 10);
  return `M ${fromX + 10} ${fromY} C ${midX} ${fromY + bend}, ${midX} ${toY - bend}, ${toX - 10} ${toY}`;
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
