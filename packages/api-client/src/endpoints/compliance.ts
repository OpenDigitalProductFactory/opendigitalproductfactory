import type { DpfClient } from "../client";
import type { PaginatedResponse } from "@dpf/types";

// Server returns Prisma model shapes — use generic records here since
// the compliance entity types are not yet exported from @dpf/types.
// These can be narrowed once the types package exports them.

export function complianceEndpoints(client: DpfClient) {
  return {
    listAlerts: (params?: {
      cursor?: string;
      limit?: number;
      status?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.status) qs.set("status", params.status);
      const query = qs.toString();
      return client.get<PaginatedResponse<Record<string, unknown>>>(
        `/api/v1/compliance/alerts${query ? `?${query}` : ""}`,
      );
    },

    listIncidents: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<Record<string, unknown>>>(
        `/api/v1/compliance/incidents${query ? `?${query}` : ""}`,
      );
    },

    listControls: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<Record<string, unknown>>>(
        `/api/v1/compliance/controls${query ? `?${query}` : ""}`,
      );
    },

    listRegulations: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<Record<string, unknown>>>(
        `/api/v1/compliance/regulations${query ? `?${query}` : ""}`,
      );
    },

    listAuditFindings: (
      auditId: string,
      params?: { cursor?: string; limit?: number },
    ) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<Record<string, unknown>>>(
        `/api/v1/compliance/audits/${auditId}/findings${query ? `?${query}` : ""}`,
      );
    },

    listCorrectiveActions: (params?: {
      cursor?: string;
      limit?: number;
      status?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.status) qs.set("status", params.status);
      const query = qs.toString();
      return client.get<PaginatedResponse<Record<string, unknown>>>(
        `/api/v1/compliance/corrective-actions${query ? `?${query}` : ""}`,
      );
    },
  };
}
