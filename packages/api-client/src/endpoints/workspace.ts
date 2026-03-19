import type { DpfClient } from "../client";
import type {
  DashboardResponse,
  PaginatedResponse,
  ActivityItem,
} from "@dpf/types";

export function workspaceEndpoints(client: DpfClient) {
  return {
    dashboard: () =>
      client.get<DashboardResponse>("/api/v1/workspace/dashboard"),

    activity: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<ActivityItem>>(
        `/api/v1/workspace/activity${query ? `?${query}` : ""}`,
      );
    },
  };
}
