export type DiscoverySourceKind =
  | "dpf_bootstrap"
  | "host"
  | "docker"
  | "kubernetes";

export type DiscoveredItemInput = {
  sourceKind?: DiscoverySourceKind;
  itemType: string;
  name: string;
  externalRef?: string;
  naturalKey?: string;
  sourcePath?: string;
  confidence?: number;
  attributes?: Record<string, unknown>;
};

export type DiscoveredRelationshipInput = {
  sourceKind?: DiscoverySourceKind;
  relationshipType: string;
  fromExternalRef?: string;
  toExternalRef?: string;
  confidence?: number;
  attributes?: Record<string, unknown>;
};

export type CollectorOutput = {
  items: DiscoveredItemInput[];
  relationships: DiscoveredRelationshipInput[];
  warnings?: string[];
};

export type CollectorContext = {
  sourceKind: DiscoverySourceKind;
};

export type CollectorName = "host" | "docker" | "kubernetes";

export type DiscoveryCollector = (ctx?: CollectorContext) => Promise<CollectorOutput>;
