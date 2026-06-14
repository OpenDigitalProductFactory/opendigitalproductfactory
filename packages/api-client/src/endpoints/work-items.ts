import type { DpfClient } from "../client";
import type {
  PaginatedResponse,
  WorkItemSummary,
  WorkItemDetail,
  WorkItemStatusUpdateRequest,
} from "@dpf/types";

export function workItemsEndpoints(client: DpfClient) {
  return {
    /** The signed-in field worker's assigned jobs. */
    list: (params?: { cursor?: string; limit?: number; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.status) qs.set("status", params.status);
      const query = qs.toString();
      return client.get<PaginatedResponse<WorkItemSummary>>(
        `/api/v1/work-items${query ? `?${query}` : ""}`,
      );
    },

    get: (itemId: string) =>
      client.get<WorkItemDetail>(
        `/api/v1/work-items/${encodeURIComponent(itemId)}`,
      ),

    /** Field check-in/out — transition the job status. */
    updateStatus: (itemId: string, input: WorkItemStatusUpdateRequest) =>
      client.patch<WorkItemDetail>(
        `/api/v1/work-items/${encodeURIComponent(itemId)}`,
        input,
      ),
  };
}
