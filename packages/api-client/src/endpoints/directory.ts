import type { DpfClient } from "../client";
import type { NearbyResponse } from "@dpf/types";

/**
 * Directory endpoints — public geo discovery for the mobile customer
 * surface. Today single-install (the install reports itself when the
 * query point is within its radius); the same shape works once the
 * Town M5 hosted federation directory lands.
 */
export function directoryEndpoints(client: DpfClient) {
  return {
    nearby: (input: {
      latitude: number;
      longitude: number;
      radiusKm?: number;
    }) => {
      const qs = new URLSearchParams();
      qs.set("lat", String(input.latitude));
      qs.set("lng", String(input.longitude));
      if (input.radiusKm !== undefined) {
        qs.set("radiusKm", String(input.radiusKm));
      }
      return client.get<NearbyResponse>(
        `/api/v1/directory/nearby?${qs.toString()}`,
      );
    },
  };
}
