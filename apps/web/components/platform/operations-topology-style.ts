// Pure, token-backed visual grammar for the unified Operations Topology canvas.
//
// Canonical route/marker semantics for the authoritative canvas. Kept
// React/DOM-free and token-only (no raw hex).
//
// Spec: docs/superpowers/specs/2026-06-05-ai-operations-map-three-band-cohesive-layout-design.md §7 Stage B

import type {
  OperationsMapRoutingMarkerType,
  OperationsMapRoutingRouteState,
} from "@/lib/ai-operations-map/types";
import { a2aReplayWindow, type A2aReplayRange } from "./a2a-interaction-graph";

/**
 * Whether a provider route is visible at the shared replay playhead. Mirrors
 * AiOperationsMap's routeVisibleAtReplayTime so the unified canvas scrubs
 * identically to the legacy panel, and reuses the same look-back window as the
 * A2A band so both halves share one playhead.
 */
export function routeVisibleAtReplayTime(
  route: { state: OperationsMapRoutingRouteState; occurredAt: string | null },
  selectedTime: number,
  range: A2aReplayRange,
): boolean {
  if (!route.occurredAt) return true;
  const occurredAt = Date.parse(route.occurredAt);
  if (!Number.isFinite(occurredAt)) return true;
  const window = a2aReplayWindow(range);

  if (route.state === "scheduled") {
    return selectedTime >= range.current && selectedTime <= occurredAt + window;
  }
  if (selectedTime < occurredAt) return false;
  if (route.state === "active" || route.state === "secondary" || route.state === "failover") {
    return selectedTime >= range.current || selectedTime - occurredAt <= window;
  }
  return selectedTime - occurredAt <= window;
}

export function routeStateStroke(state: OperationsMapRoutingRouteState): string {
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

export function routeStateDash(state: OperationsMapRoutingRouteState): string | undefined {
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

export function routeStateOpacity(state: OperationsMapRoutingRouteState): number {
  if (state === "historical") return 0.5;
  if (state === "scheduled") return 0.72;
  return 0.95;
}

export function routeWidth(trafficWeight: number): number {
  return Math.min(5, 1.25 + trafficWeight * 0.45);
}

export function markerTypeStroke(type: OperationsMapRoutingMarkerType): string {
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

export const ROUTE_STATE_LABEL: Record<OperationsMapRoutingRouteState, string> = {
  active: "Selected active route",
  secondary: "Normal secondary traffic",
  failover: "Failover or degraded route",
  scheduled: "Scheduled or forecast route",
  historical: "Historical route",
};
