import type {
  SemanticSurfaceGraph,
  SemanticSurfaceDelta,
  SurfaceActionSuccess,
  AvailableSurfaceAction,
  SurfaceCatalogEntry,
  SurfaceSession,
  SurfaceSummary,
} from "@dpf/types";

import type { DpfClient } from "../client";

export type SurfaceOpenRequest = {
  surfaceId?: string;
  route?: string;
  taskIntent?: string;
  workroomType?: string;
  resourceType?: string;
  mobileViewId?: string;
};

export type SurfaceOpenResponse = {
  ok: true;
  session: SurfaceSession;
  summary: SurfaceSummary;
  actions: AvailableSurfaceAction[];
};

export function surfaceEndpoints(client: DpfClient) {
  return {
    list: (query: { taskIntent?: string; workroomType?: string; resourceType?: string } = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return client.get<{ surfaces: SurfaceCatalogEntry[] }>(`/api/v1/surfaces${suffix}`);
    },
    open: (request: SurfaceOpenRequest) => client.post<SurfaceOpenResponse>("/api/v1/surfaces", request),
    snapshot: (sessionId: string, sinceRevision?: string) => {
      const suffix = sinceRevision ? `?sinceRevision=${encodeURIComponent(sinceRevision)}` : "";
      return client.get<{ ok: true; graph: SemanticSurfaceGraph } | { ok: true; delta: SemanticSurfaceDelta }>(`/api/v1/surfaces/${encodeURIComponent(sessionId)}${suffix}`);
    },
    syncClientState: (sessionId: string, request: { expectedRevision: string; sequence: number; changes: Record<string, unknown> }) =>
      client.post<SurfaceActionSuccess>(`/api/v1/surfaces/${encodeURIComponent(sessionId)}/client-state`, request),
    act: (sessionId: string, request: { actionId: string; expectedRevision: string; args?: Record<string, unknown>; idempotencyKey?: string }) =>
      client.post<SurfaceActionSuccess>(`/api/v1/surfaces/${encodeURIComponent(sessionId)}/act`, request),
    close: (sessionId: string) => client.delete<void>(`/api/v1/surfaces/${encodeURIComponent(sessionId)}`),
  };
}
