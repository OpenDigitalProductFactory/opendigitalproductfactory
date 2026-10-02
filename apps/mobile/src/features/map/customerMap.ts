/**
 * The phone's customer map (BI-3DAE2169): what the Map screen draws and what it
 * says when it cannot draw a street map. Pure, so the screen's states are
 * testable without the native map.
 *
 * The map style comes from the one builder in @dpf/types that the web canvas
 * also uses. Two phone-specific changes: the GeoJSON sources are filled from
 * the scene, and the site layers are left out because MapLibre Native draws
 * text only from glyph files and the shared style fetches none. Sites are drawn
 * as native markers instead, each a circle with a letter (WCAG 1.4.1).
 */
import {
  buildGeographicStyle,
  GEOGRAPHIC_SOURCE_IDS,
  type CustomerMapSiteSummary,
  type CustomerSitesMapResponse,
  type MapStyle,
} from "@dpf/types";
import type { ThemeColors } from "@/src/lib/theme";

const PHONE_OMITTED_LAYERS = new Set(["dpf-placements", "dpf-placement-labels"]);

export type MapScreenInput =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; response: CustomerSitesMapResponse; mapFailed: boolean };

export type MapScreenState =
  | { kind: "loading" }
  /** `street`: the street map is drawn. `plain`: zones and sites on a plain background. `none`: the list only. */
  | { kind: "loaded"; map: "street" | "plain" | "none"; reason: string | null };

export function mapScreenState(input: MapScreenInput): MapScreenState {
  if (input.status === "loading") return { kind: "loading" };
  if (input.status === "error") {
    return { kind: "loaded", map: "none", reason: `The map could not be loaded: ${input.message}` };
  }
  const { response, mapFailed } = input;
  if (mapFailed) {
    return { kind: "loaded", map: "none", reason: "The map could not start on this phone. Your sites are listed below." };
  }
  switch (response.basemap) {
    case "available":
      return { kind: "loaded", map: "street", reason: null };
    case "no-pack-installed":
      return {
        kind: "loaded",
        map: "plain",
        reason: "No street map is installed on your workspace, so sites are shown on a plain background.",
      };
    case "out-of-coverage":
      return {
        kind: "loaded",
        map: "plain",
        reason: "The installed street map does not cover these sites, so they are shown on a plain background.",
      };
    case "nothing-to-show":
      return {
        kind: "loaded",
        map: "none",
        reason:
          response.sites.length === 0
            ? "There are no customer sites yet."
            : "None of your customer sites has a location yet, so there is nothing to put on a map.",
      };
  }
}

/** The letter on a site's marker: the customer's initial, so a site is never told apart by colour alone. */
export function siteLetter(accountName: string): string {
  const match = accountName.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase() : "?";
}

export type SiteMarker = CustomerMapSiteSummary & { letter: string; longitude: number; latitude: number };

/** One marker per placed site, positioned from the scene's placement features. */
export function siteMarkers(response: CustomerSitesMapResponse): SiteMarker[] {
  const positions = new Map<string, [number, number]>();
  for (const feature of response.model?.placements.features ?? []) {
    const { entityId } = feature.properties;
    const coordinates = feature.geometry.coordinates;
    if (feature.geometry.type === "Point" && entityId && Array.isArray(coordinates)) {
      positions.set(entityId, [Number(coordinates[0]), Number(coordinates[1])]);
    }
  }
  return response.sites.flatMap((site) => {
    const position = positions.get(site.siteId);
    return position ? [{ ...site, letter: siteLetter(site.accountName), longitude: position[0], latitude: position[1] }] : [];
  });
}

export function phoneMapStyle(input: {
  response: CustomerSitesMapResponse;
  colors: ThemeColors;
  origin: string;
  street: boolean;
}): MapStyle {
  const { response, colors, origin, street } = input;
  const style = buildGeographicStyle({
    tokens: {
      background: colors.surface1,
      surface: colors.surface2,
      text: colors.text,
      muted: colors.textMuted,
      border: colors.border,
      accent: colors.primary,
    },
    origin,
    pack: street && response.pack ? { packId: response.pack.packId, attribution: response.pack.attribution } : undefined,
  });
  if (response.model) {
    style.sources[GEOGRAPHIC_SOURCE_IDS.zones] = { type: "geojson", data: response.model.zones };
  }
  return { ...style, layers: style.layers.filter((layer) => !PHONE_OMITTED_LAYERS.has(layer.id)) };
}

/**
 * The pattern the bearer header is attached to: requests to the install's own
 * origin only, so the token never reaches another host.
 */
export function installOriginPattern(origin: string): string {
  const { protocol, host } = new URL(origin);
  const escaped = `${protocol}//${host}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}/`;
}

export const MAP_LEGEND: ReadonlyArray<{ key: string; symbol: "site" | "area" | "you"; text: string }> = [
  { key: "site", symbol: "site", text: "Customer site. The letter is the customer's initial; tap to open the account." },
  { key: "area", symbol: "area", text: "Service area." },
  { key: "you", symbol: "you", text: "You, when Follow me is on." },
];

/** The camera bounds for Recenter, as [west, south, east, north]. */
export function sceneBounds(response: CustomerSitesMapResponse): [number, number, number, number] | null {
  const bounds = response.model?.bounds;
  if (!bounds || bounds.crossesAntimeridian) return null;
  return [bounds.west, bounds.south, bounds.east, bounds.north];
}
