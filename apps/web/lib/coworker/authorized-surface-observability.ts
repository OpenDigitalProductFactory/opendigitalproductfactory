import {
  authorizedSurfaceCompatibilityFallbacks,
  authorizedSurfaceGraphNodes,
  authorizedSurfaceLatency,
  authorizedSurfaceOperations,
} from "@/lib/operate/metrics";

export type AuthorizedSurfaceObservation = {
  operation: "list" | "open" | "snapshot" | "query" | "act" | "close";
  outcome: string;
  mode?: string;
  surfaceId?: string;
  durationMs?: number;
  nodeCount?: number;
};

export function observeAuthorizedSurface(event: AuthorizedSurfaceObservation): void {
  const labels = {
    operation: event.operation,
    outcome: event.outcome,
    mode: event.mode ?? "unknown",
    surface_id: event.surfaceId ?? "unknown",
  };
  authorizedSurfaceOperations.inc(labels);
  if (event.durationMs !== undefined) {
    authorizedSurfaceLatency.observe({
      operation: event.operation,
      mode: labels.mode,
      surface_id: labels.surface_id,
    }, event.durationMs / 1000);
  }
  if (event.nodeCount !== undefined) {
    authorizedSurfaceGraphNodes.observe({
      operation: event.operation,
      mode: labels.mode,
      surface_id: labels.surface_id,
    }, event.nodeCount);
  }
}
export function observeSurfaceCompatibilityFallback(input: {
  adapter: "screen" | "page-context" | "dom-observer";
  reason: string;
  route?: string;
}): void {
  authorizedSurfaceCompatibilityFallbacks.inc({
    adapter: input.adapter,
    reason: input.reason,
    route: input.route ?? "unknown",
  });
}
