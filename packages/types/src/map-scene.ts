// The phone map's view of a geographic scene (BI-3DAE2169): GeoJSON feature
// collections the native renderer draws, plus the street-map pack covering them.

export type MapFeatureProperties = {
  featureId: string;
  featureKind: "zone" | "placement";
  label: string;
  entityKind: string | null;
  entityId: string | null;
  selected: boolean;
  statusLabel: string | null;
  sublabel: string | null;
  intent: string | null;
};

export type MapFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry: { type: "Point" | "LineString" | "Polygon"; coordinates: unknown };
    properties: MapFeatureProperties;
  }>;
};

export type MapSceneModel = {
  viewport: { latitude: number; longitude: number; zoom: number };
  bounds: { west: number; south: number; east: number; north: number; crossesAntimeridian: boolean };
  zones: MapFeatureCollection;
  placements: MapFeatureCollection;
};

export type MapPackSummary = {
  packId: string;
  attribution: string;
  bounds: { west: number; south: number; east: number; north: number };
};

export type CustomerSitesMapResponse = {
  /** Null when no site is placed and no service area exists. */
  model: MapSceneModel | null;
  notOnMap: number;
  pack: MapPackSummary | null;
  basemap: "available" | "no-pack-installed" | "out-of-coverage" | "nothing-to-show";
};
