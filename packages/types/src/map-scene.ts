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

/** A customer site as the phone lists it, on the map or not. */
export type CustomerMapSiteSummary = {
  siteId: string;
  siteName: string;
  accountId: string;
  accountName: string;
  addressLabel: string | null;
  onMap: boolean;
};

export type CustomerSitesMapResponse = {
  /** Null when no site is placed and no service area exists. */
  model: MapSceneModel | null;
  notOnMap: number;
  /** Every site, placed ones first, so the phone can list them when it cannot draw a map. */
  sites: CustomerMapSiteSummary[];
  pack: MapPackSummary | null;
  basemap: "available" | "no-pack-installed" | "out-of-coverage" | "nothing-to-show";
};
