export const INTEGRATION_IMPORT_OWNER_SIDES = ["external", "dpf"] as const;

export type IntegrationImportOwnerSide = (typeof INTEGRATION_IMPORT_OWNER_SIDES)[number];

export const INTEGRATION_IMPORT_LINK_STATUSES = [
  "candidate",
  "linked",
  "blocked",
] as const;

export type IntegrationImportLinkStatus = (typeof INTEGRATION_IMPORT_LINK_STATUSES)[number];

export interface IntegrationImportDisplayField {
  label: string;
  value: string;
}

export interface IntegrationProposedLocalLink {
  entityType: string;
  localId: string | null;
  status: IntegrationImportLinkStatus;
  confidence: "low" | "medium" | "high";
  reason: string;
}

export interface IntegrationImportStagingRecord {
  entityFamily: string;
  externalId: string;
  sourceProvider: string;
  sourceTimestamp: string | null;
  ownerSide: IntegrationImportOwnerSide;
  proposedLocalLink: IntegrationProposedLocalLink;
  displayFields: IntegrationImportDisplayField[];
  readOnly: true;
}

export interface IntegrationImportStagingFamily {
  key: string;
  label: string;
  ownerSide: IntegrationImportOwnerSide;
  proposedLocalEntity: string;
  requiredSourceFields: readonly string[];
  reviewFields: readonly string[];
}

export interface IntegrationImportStagingDescriptor {
  schemaVersion: "1.0";
  sourceProvider: string;
  readOnly: true;
  approvalGate: string;
  rollbackExpectation: string;
  families: IntegrationImportStagingFamily[];
}
