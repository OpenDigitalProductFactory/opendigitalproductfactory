import type { DpfClient } from "../client";
import type { CustomerSitesMapResponse } from "@dpf/types";

/** Map scenes for the phone map (BI-3DAE2169). */
export function mapEndpoints(client: DpfClient) {
  return {
    /** Customer sites, service areas and the covering street-map pack. */
    customerSites: () => client.get<CustomerSitesMapResponse>("/api/v1/map/customer-sites"),
  };
}
