/**
 * Renderer-neutral authored geometry for an operational twin.
 *
 * A SceneLayout stores operator-authored position, not live business state.
 * Placements bind geometry to durable domain entities through SceneEntityRef;
 * renderers join those references to the current Operations snapshot.
 *
 * This package intentionally has no React Flow, MapLibre, GeoJSON, Prisma, or
 * browser dependency. Persistence and rendering are separate downstream seams.
 */

export const TWIN_SPACE_KINDS = [
  "cartesian-interior",
  "geographic",
  "node-graph",
] as const;

export type SpaceKind = (typeof TWIN_SPACE_KINDS)[number];

export interface SceneEntityRef {
  readonly kind: string;
  readonly id: string;
}

export interface CartesianCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface GeographicCoordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export interface CartesianViewport extends CartesianCoordinate {
  readonly zoom: number;
}

export interface GeographicViewport extends GeographicCoordinate {
  readonly zoom: number;
}

export interface CartesianRectangleGeometry extends CartesianCoordinate {
  readonly kind: "rectangle";
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
}

export interface CartesianPolygonGeometry {
  readonly kind: "polygon";
  readonly points: readonly CartesianCoordinate[];
}

export type CartesianRegionGeometry =
  | CartesianRectangleGeometry
  | CartesianPolygonGeometry;

export interface GeographicPointGeometry extends GeographicCoordinate {
  readonly kind: "point";
}

export interface GeographicLineGeometry {
  readonly kind: "line-string";
  readonly coordinates: readonly GeographicCoordinate[];
}

export interface GeographicPolygonGeometry {
  readonly kind: "polygon";
  readonly rings: readonly (readonly GeographicCoordinate[])[];
}

export type GeographicPlacementGeometry =
  | GeographicPointGeometry
  | GeographicLineGeometry
  | GeographicPolygonGeometry;

export interface CartesianPlacementGeometry extends CartesianCoordinate {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  /**
   * Domain-facing shape token such as round-table, chair, bay, rack, or room.
   * The renderer owns its visual implementation; the contract stays extensible.
   */
  readonly shapeKind: string;
}

export interface NodeGraphPlacementGeometry extends CartesianCoordinate {
  readonly width?: number;
  readonly height?: number;
}

export interface SceneZoneBase<Geometry> {
  readonly id: string;
  readonly label: string;
  readonly geometry: Geometry;
}

export interface ScenePlacementBase<Geometry> {
  readonly id: string;
  readonly label?: string;
  readonly entityRef: SceneEntityRef;
  readonly geometry: Geometry;
}

export type CartesianSceneZone = SceneZoneBase<CartesianRegionGeometry>;
export type GeographicSceneZone = SceneZoneBase<GeographicPolygonGeometry>;
export type NodeGraphSceneZone = SceneZoneBase<CartesianRegionGeometry>;

export type CartesianScenePlacement =
  ScenePlacementBase<CartesianPlacementGeometry>;
export type GeographicScenePlacement =
  ScenePlacementBase<GeographicPlacementGeometry>;
export type NodeGraphScenePlacement =
  ScenePlacementBase<NodeGraphPlacementGeometry>;

export interface NodeGraphSceneConnector {
  readonly id: string;
  readonly sourcePlacementId: string;
  readonly targetPlacementId: string;
  /** Domain-facing relation token such as conveyor, cable, route, or flow. */
  readonly kind: string;
  readonly label?: string;
}

interface SceneLayoutBase<
  Kind extends SpaceKind,
  Viewport,
  Zone,
  Placement,
> {
  /** Version of the persisted JSON contract, independent from live-state data. */
  readonly schemaVersion: 1;
  readonly spaceKind: Kind;
  readonly viewport: Viewport;
  readonly zones: readonly Zone[];
  readonly placements: readonly Placement[];
  /** Durable asset reference for an optional floor plan or authored underlay. */
  readonly underlayRef?: string;
}

export interface CartesianSceneLayout
  extends SceneLayoutBase<
    "cartesian-interior",
    CartesianViewport,
    CartesianSceneZone,
    CartesianScenePlacement
  > {}

export interface GeographicSceneLayout
  extends SceneLayoutBase<
    "geographic",
    GeographicViewport,
    GeographicSceneZone,
    GeographicScenePlacement
  > {}

export interface NodeGraphSceneLayout
  extends SceneLayoutBase<
    "node-graph",
    CartesianViewport,
    NodeGraphSceneZone,
    NodeGraphScenePlacement
  > {
  readonly connectors: readonly NodeGraphSceneConnector[];
}

/**
 * The top-level discriminant prevents a scene from mixing renderer coordinate
 * systems. Configure/operate mode is runtime UI state and is not persisted here.
 */
export type SceneLayout =
  | CartesianSceneLayout
  | GeographicSceneLayout
  | NodeGraphSceneLayout;
