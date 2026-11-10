import type { DpfClient } from "../client";
import type {
  AppendJobEvidenceRequest,
  JobEvidenceResponse,
  PaginatedResponse,
  SiteLocationConfirmationInput,
  SiteLocationConfirmationRefusal,
  SiteLocationConfirmationResult,
  WorkItemSitesResponse,
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

    /**
     * Append one completion photo to the assigned work item's evidence JSON.
     * Server is the source of truth — the response carries the merged
     * record after the append.
     */
    appendEvidence: (itemId: string, input: AppendJobEvidenceRequest) =>
      client.post<JobEvidenceResponse>(
        `/api/v1/work-items/${encodeURIComponent(itemId)}/evidence`,
        input,
      ),

    /** The customer sites this job can be at (BI-C318C227 §2.2). */
    sites: (itemId: string) =>
      client.get<WorkItemSitesResponse>(
        `/api/v1/work-items/${encodeURIComponent(itemId)}/sites`,
      ),

    /**
     * Confirm a site's location from the device's position at check-in. A
     * refusal (inaccurate fix, far from the address, already confirmed, ...)
     * comes back as a result, not an error, so the screen can answer it.
     */
    confirmSiteLocation: async (
      siteId: string,
      input: SiteLocationConfirmationInput,
    ): Promise<SiteLocationConfirmationResult> => {
      try {
        return await client.post<SiteLocationConfirmationResult>(
          `/api/v1/customer-sites/${encodeURIComponent(siteId)}/location/device-confirmation`,
          input,
        );
      } catch (err) {
        const refusal = err as { code?: string; reason?: SiteLocationConfirmationRefusal; distanceMeters?: number };
        if (refusal?.code === "SITE_LOCATION_REFUSED" && refusal.reason) {
          return { status: "refused", reason: refusal.reason, distanceMeters: refusal.distanceMeters };
        }
        throw err;
      }
    },
  };
}
