import type { DpfClient } from "../client";
import type {
  Epic,
  BacklogItem,
  PaginatedResponse,
  CreateEpicRequest,
  UpdateEpicRequest,
  CreateBacklogItemRequest,
  UpdateBacklogItemRequest,
} from "@dpf/types";

export function opsEndpoints(client: DpfClient) {
  return {
    // Epics
    listEpics: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<Epic>>(
        `/api/v1/ops/epics${query ? `?${query}` : ""}`,
      );
    },

    createEpic: (input: CreateEpicRequest) =>
      client.post<Epic>("/api/v1/ops/epics", input),

    updateEpic: (id: string, input: UpdateEpicRequest) =>
      client.patch<Epic>(`/api/v1/ops/epics/${id}`, input),

    // Backlog
    listBacklog: (params?: {
      cursor?: string;
      limit?: number;
      status?: string;
      epicId?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.status) qs.set("status", params.status);
      if (params?.epicId) qs.set("epicId", params.epicId);
      const query = qs.toString();
      return client.get<PaginatedResponse<BacklogItem>>(
        `/api/v1/ops/backlog${query ? `?${query}` : ""}`,
      );
    },

    createBacklogItem: (input: CreateBacklogItemRequest) =>
      client.post<BacklogItem>("/api/v1/ops/backlog", input),

    updateBacklogItem: (id: string, input: UpdateBacklogItemRequest) =>
      client.patch<BacklogItem>(`/api/v1/ops/backlog/${id}`, input),

    deleteBacklogItem: (id: string) =>
      client.delete<{ deleted: boolean }>(`/api/v1/ops/backlog/${id}`),
  };
}
