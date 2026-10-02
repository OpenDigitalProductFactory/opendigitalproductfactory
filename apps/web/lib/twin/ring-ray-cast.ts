// Even-odd ray-cast shared by the cartesian and geographic scene helpers.
// A point counts as inside when a ray to +x crosses the ring an odd number of
// times; a closing point equal to the first is harmless.

export interface PlanarPoint {
  readonly x: number;
  readonly y: number;
}

export function pointInRing(point: PlanarPoint, ring: readonly PlanarPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
