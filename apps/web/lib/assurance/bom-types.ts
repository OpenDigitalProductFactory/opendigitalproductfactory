export const BOM_COMPONENT_TYPES = ["library", "framework", "application", "container", "model"] as const;
export type BomComponentType = (typeof BOM_COMPONENT_TYPES)[number];

export interface NormalizedBomComponent {
  componentKey: string;
  componentType: BomComponentType;
  name: string;
  version: string | null;
  packageUrl: string | null;
  supplierName: string | null;
  licenseExpression: string | null;
  ecosystem: string | null;
  scope: string | null;
  metadata: Record<string, unknown>;
}

export interface NormalizedBomOccurrence {
  occurrenceKey: string;
  componentKey: string;
  workspaceName: string | null;
  workspacePath: string | null;
  dependencyKind: string | null;
  direct: boolean;
  evidence: Record<string, unknown>;
}

export interface CycloneDxDocument {
  bomFormat: "CycloneDX";
  specVersion: "1.7";
  serialNumber: string;
  version: number;
  metadata: Record<string, unknown>;
  components: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
}

export interface GeneratedBom {
  cyclonedx: CycloneDxDocument;
  components: NormalizedBomComponent[];
  occurrences: NormalizedBomOccurrence[];
  sourceDigest: string;
  documentDigest: string;
}
