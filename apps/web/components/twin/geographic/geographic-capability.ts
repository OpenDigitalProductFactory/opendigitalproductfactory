// What a geographic view can honestly draw (BI-814F86E1, design §2.5,
// AC-GEO-DEGRADE-1). The caller always renders its own accessible list; this
// says whether the map enhancement is available and, if not, why.

import type { GeographicBounds } from "@/lib/twin/geographic-scene";
import { packCoveringBounds, type InstalledPack } from "@/lib/twin/map-pack-coverage";

export { packCoveringBounds, type InstalledPack };

export type GeographicRendererCapability =
  | { state: "renderer-ready"; pack: InstalledPack | null }
  | { state: "webgl-unavailable" }
  | { state: "region-pack-missing" }
  | { state: "region-out-of-coverage" };

export function geographicRendererCapability(input: {
  webgl: boolean;
  packs: readonly InstalledPack[];
  bounds: GeographicBounds;
  /** True when the view is meaningless without a street layer. */
  requiresBasemap: boolean;
}): GeographicRendererCapability {
  if (!input.webgl) return { state: "webgl-unavailable" };
  const pack = packCoveringBounds(input.packs, input.bounds);
  if (pack) return { state: "renderer-ready", pack };
  if (!input.requiresBasemap) return { state: "renderer-ready", pack: null };
  return input.packs.length === 0 ? { state: "region-pack-missing" } : { state: "region-out-of-coverage" };
}
