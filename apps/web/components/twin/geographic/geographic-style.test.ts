import { describe, expect, it } from "vitest";

import { buildGeographicStyle, GEOGRAPHIC_SOURCE_IDS, type GeographicStyleTokens } from "@dpf/types";

const light: GeographicStyleTokens = {
  background: "#ffffff",
  surface: "#f4f4f5",
  text: "#18181b",
  muted: "#71717a",
  border: "#d4d4d8",
  accent: "#2563eb",
};
const dark: GeographicStyleTokens = { ...light, background: "#09090b", surface: "#18181b", text: "#fafafa" };
const pack = { packId: "us-texas", attribution: "© OpenStreetMap contributors" };
const origin = "https://dpf.example";

function urls(value: unknown): string[] {
  return JSON.stringify(value).match(/[a-z][a-z0-9+.-]*:\/\/[^"]+/gi) ?? [];
}

describe("buildGeographicStyle", () => {
  it.each([
    ["light, no pack", light, undefined],
    ["dark, no pack", dark, undefined],
    ["light, with pack", light, pack],
    ["dark, with pack", dark, pack],
  ])("%s: no glyphs, no sprite, no off-origin URL", (_name, tokens, maybePack) => {
    const style = buildGeographicStyle({ tokens, pack: maybePack, origin });
    expect(style.version).toBe(8);
    expect(style).not.toHaveProperty("glyphs");
    expect(style).not.toHaveProperty("sprite");
    for (const url of urls(style)) {
      const target = new URL(url.replace(/^pmtiles:\/\//, ""));
      expect(target.origin).toBe(origin);
      expect(target.pathname.startsWith("/api/map-assets/")).toBe(true);
    }
  });

  it("draws the background and the scene layers from the theme tokens", () => {
    const style = buildGeographicStyle({ tokens: dark, origin });
    const byId = Object.fromEntries(style.layers.map((layer) => [layer.id, layer]));
    expect(byId["dpf-background"]).toMatchObject({ type: "background", paint: { "background-color": dark.background } });
    expect(byId["dpf-zones-fill"]).toMatchObject({ type: "fill", source: GEOGRAPHIC_SOURCE_IDS.zones });
    expect(byId["dpf-zones-outline"]).toMatchObject({ type: "line", source: GEOGRAPHIC_SOURCE_IDS.zones });
    expect(byId["dpf-placements"]).toMatchObject({ type: "circle", source: GEOGRAPHIC_SOURCE_IDS.placements });
    expect(byId["dpf-placement-labels"]).toMatchObject({ type: "symbol", layout: { "text-field": ["get", "label"] } });
    expect(JSON.stringify(style)).toContain(dark.accent);
  });

  it("adds the pack's basemap source and attribution only when a pack is given", () => {
    expect(buildGeographicStyle({ tokens: light, origin }).sources).not.toHaveProperty("dpf-basemap");
    const withPack = buildGeographicStyle({ tokens: light, pack, origin });
    expect(withPack.sources["dpf-basemap"]).toEqual({
      type: "vector",
      url: "pmtiles://https://dpf.example/api/map-assets/us-texas",
      attribution: "© OpenStreetMap contributors",
    });
    const ids = withPack.layers.map((layer) => layer.id);
    expect(ids.indexOf("dpf-basemap-water")).toBeLessThan(ids.indexOf("dpf-zones-fill"));
  });
});
