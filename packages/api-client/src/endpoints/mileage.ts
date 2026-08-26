import type { DpfClient } from "../client";
import type {
  ClassifyTripRequest,
  GrantMileageConsentRequest,
  MileageConsentState,
  MileageTripSummary,
  PaginatedResponse,
  RecordTripRequest,
} from "@dpf/types";

export function mileageEndpoints(client: DpfClient) {
  return {
    /** The signed-in driver's own captured drives, newest first. */
    list: (params?: { limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<MileageTripSummary>>(
        `/api/v1/mileage/trips${query ? `?${query}` : ""}`,
      );
    },

    /**
     * Record one captured drive. The server resolves the driver from the
     * session and refuses without a granted consent — the client never asserts
     * whose drive this is.
     */
    record: (input: RecordTripRequest) =>
      client.post<MileageTripSummary>("/api/v1/mileage/trips", input),

    /** Classify a drive. Refused server-side once the drive is claimed. */
    classify: (tripId: string, input: ClassifyTripRequest) =>
      client.patch<MileageTripSummary>(
        `/api/v1/mileage/trips/${encodeURIComponent(tripId)}`,
        input,
      ),

    /** The driver's current consent state — capture must check this first. */
    consent: () => client.get<MileageConsentState>("/api/v1/mileage/consent"),

    /** Record an explicit grant against the disclosure the driver was shown. */
    grantConsent: (input: GrantMileageConsentRequest) =>
      client.post<MileageConsentState>("/api/v1/mileage/consent", input),
  };
}
