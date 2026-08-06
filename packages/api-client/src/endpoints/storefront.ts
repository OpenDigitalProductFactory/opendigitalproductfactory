import type { DpfClient } from "../client";
import type { NearbyBusinessesResponse, PublicMenu } from "@dpf/types";

/**
 * Public storefront endpoints — the anonymous walk-up consumer surface.
 * No auth: a visitor with no account browses businesses + menus. Distinct
 * from `directory` (install-level discovery): these return consumer
 * storefronts + their menus. Spec: docs/superpowers/specs/2026-08-05-viral-
 * walkup-consumer-front-door-design.md (BI-9FEB61B8).
 */
export function storefrontEndpoints(client: DpfClient) {
  return {
    /** Businesses near a coordinate, for the "Right here" screen. */
    nearby: (input: { latitude: number; longitude: number }) => {
      const qs = new URLSearchParams();
      qs.set("lat", String(input.latitude));
      qs.set("lng", String(input.longitude));
      return client.get<NearbyBusinessesResponse>(
        `/api/storefront/nearby?${qs.toString()}`,
      );
    },

    /** One storefront's public menu, grouped by category. */
    menu: (slug: string) =>
      client.get<PublicMenu>(
        `/api/storefront/${encodeURIComponent(slug)}/menu`,
      ),
  };
}
