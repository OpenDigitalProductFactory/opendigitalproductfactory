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

export type DiscoveredSoftwareInput = {
  sourceKind?: DiscoverySourceKind;
  entityExternalRef?: string;
  hostExternalRef?: string;
  containerExternalRef?: string;
  evidenceSource: string;
  packageManager?: string;
  rawVendor?: string;
  rawProductName?: string;
  rawPackageName?: string;
  rawVersion?: string;
  installLocation?: string;
  metadata?: Record<string, unknown>;
};

export type CollectorOutput = {
  items: DiscoveredItemInput[];
  relationships: DiscoveredRelationshipInput[];
  software?: DiscoveredSoftwareInput[];
  warnings?: string[];
};

export type CollectorContext = {
  sourceKind: DiscoverySourceKind;
};

export type CollectorName = "host" | "docker" | "kubernetes";

export type DiscoveryCollector = (ctx?: CollectorContext) => Promise<CollectorOutput>;
