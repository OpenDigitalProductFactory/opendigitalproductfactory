// MapLibre style for a geographic scene, built from the theme's --dpf-* tokens
// (BI-814F86E1, design §2.4, AC-GEO-RENDER-2).
//
// The style declares no `glyphs` and no `sprite`: MapLibre 6 draws label text
// from the browser's local fonts when no glyph source covers it, so nothing is
// fetched from a font or sprite CDN. The only URL is the install's own
// pmtiles:// pack route, and only when a pack is given.

import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";

export type GeographicStyleTokens = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
};

/** The CSS custom properties each token is read from. */
export const GEOGRAPHIC_TOKEN_VARIABLES: Record<keyof GeographicStyleTokens, string> = {
  background: "--dpf-bg",
  surface: "--dpf-surface-2",
  text: "--dpf-text",
  muted: "--dpf-muted",
  border: "--dpf-border",
  accent: "--dpf-accent",
};

export const GEOGRAPHIC_SOURCE_IDS = { zones: "dpf-zones", placements: "dpf-placements" } as const;
const BASEMAP_SOURCE_ID = "dpf-basemap";

const EMPTY: SourceSpecification = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

export function mapPackSourceUrl(origin: string, packId: string): string {
  return `pmtiles://${origin}/api/map-assets/${encodeURIComponent(packId)}`;
}

function basemapLayers(tokens: GeographicStyleTokens): LayerSpecification[] {
  return [
    { id: "dpf-basemap-earth", type: "fill", source: BASEMAP_SOURCE_ID, "source-layer": "earth", paint: { "fill-color": tokens.surface } },
    { id: "dpf-basemap-water", type: "fill", source: BASEMAP_SOURCE_ID, "source-layer": "water", paint: { "fill-color": tokens.background } },
    {
      id: "dpf-basemap-roads",
      type: "line",
      source: BASEMAP_SOURCE_ID,
      "source-layer": "roads",
      paint: { "line-color": tokens.border, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 3] },
    },
  ];
}

export function buildGeographicStyle(input: {
  tokens: GeographicStyleTokens;
  origin: string;
  pack?: { packId: string; attribution: string };
}): StyleSpecification {
  const { tokens, pack } = input;
  const sources: Record<string, SourceSpecification> = {
    [GEOGRAPHIC_SOURCE_IDS.zones]: EMPTY,
    [GEOGRAPHIC_SOURCE_IDS.placements]: EMPTY,
  };
  if (pack) {
    sources[BASEMAP_SOURCE_ID] = {
      type: "vector",
      url: mapPackSourceUrl(input.origin, pack.packId),
      attribution: pack.attribution,
    };
  }
  return {
    version: 8,
    sources,
    layers: [
      { id: "dpf-background", type: "background", paint: { "background-color": tokens.background } },
      ...(pack ? basemapLayers(tokens) : []),
      {
        id: "dpf-zones-fill",
        type: "fill",
        source: GEOGRAPHIC_SOURCE_IDS.zones,
        paint: { "fill-color": tokens.accent, "fill-opacity": 0.15 },
      },
      {
        id: "dpf-zones-outline",
        type: "line",
        source: GEOGRAPHIC_SOURCE_IDS.zones,
        paint: { "line-color": tokens.accent, "line-width": 1.5 },
      },
      {
        id: "dpf-placements",
        type: "circle",
        source: GEOGRAPHIC_SOURCE_IDS.placements,
        paint: {
          "circle-color": tokens.accent,
          "circle-radius": ["case", ["boolean", ["get", "selected"], false], 8, 5],
          "circle-stroke-color": ["case", ["boolean", ["get", "selected"], false], tokens.text, tokens.background],
          "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 2.5, 1.5],
        },
      },
      {
        id: "dpf-placement-labels",
        type: "symbol",
        source: GEOGRAPHIC_SOURCE_IDS.placements,
        minzoom: 12,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: { "text-color": tokens.text, "text-halo-color": tokens.background, "text-halo-width": 1.5 },
      },
    ],
  };
}
