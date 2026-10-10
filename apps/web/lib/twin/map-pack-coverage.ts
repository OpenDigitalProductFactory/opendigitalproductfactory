// Which installed map pack covers an area (BI-814F86E1). Shared by the
// renderer's capability check and the region recommendation (BI-C318C227 §2.3).

import type { GeographicBounds } from "./geographic-scene";

export type InstalledPack = {
  packId: string;
  bounds: { west: number; south: number; east: number; north: number };
};

/** The first installed pack whose bounds fully contain the scene. */
export function packCoveringBounds(packs: readonly InstalledPack[], scene: GeographicBounds): InstalledPack | null {
  if (scene.crossesAntimeridian) return null;
  return (
    packs.find(
      ({ bounds }) =>
        bounds.west <= bounds.east &&
        bounds.west <= scene.west &&
        bounds.east >= scene.east &&
        bounds.south <= scene.south &&
        bounds.north >= scene.north,
    ) ?? null
  );
}
