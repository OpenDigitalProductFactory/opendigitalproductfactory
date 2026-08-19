import { describe, expect, it } from "vitest";
import type { IntegrationImportStagingRecord } from "./import-staging";
import {
  buildIntegrationImportReviewBatch,
  fingerprintImportStagingRecord,
} from "./import-review";

const stagedInvoice: IntegrationImportStagingRecord = {
  entityFamily: "invoices",
  externalId: "qb-invoice-1001",
  sourceProvider: "quickbooks",
  sourceTimestamp: "2026-05-22T12:00:00.000Z",
  ownerSide: "external",
  proposedLocalLink: {
    entityType: "Invoice",
    localId: null,
    status: "candidate",
    confidence: "low",
    reason: "Review source-attributed QuickBooks record before creating or linking a local DPF record.",
  },
  displayFields: [
    { label: "Invoice number", value: "INV-1001" },
    { label: "Customer", value: "Acme Services" },
    { label: "Total", value: "1250.00" },
  ],
  readOnly: true,
};

describe("import review queue contract", () => {
  it("normalizes staged records into read-only review candidates", () => {
    const batch = buildIntegrationImportReviewBatch({
      batchId: "quickbooks-2026-05-22T12-00-00Z",
      sourceProvider: "quickbooks",
      providerEnvironment: "sandbox",
      sourceTimestamp: "2026-05-22T12:00:00.000Z",
      stagedRecords: [stagedInvoice],
    });

    expect(batch).toMatchObject({
      batchId: "quickbooks-2026-05-22T12-00-00Z",
      sourceProvider: "quickbooks",
      providerEnvironment: "sandbox",
      sourceTimestamp: "2026-05-22T12:00:00.000Z",
      status: "reviewing",
    });
    expect(batch.records).toHaveLength(1);
    expect(batch.records[0]).toMatchObject({
      entityFamily: "invoices",
      externalId: "qb-invoice-1001",
      sourceProvider: "quickbooks",
      sourceTimestamp: "2026-05-22T12:00:00.000Z",
      ownerSide: "external",
      readOnly: true,
      reviewStatus: "candidate",
      proposedLocalEntityType: "Invoice",
      proposedLocalId: null,
      proposedLocalStatus: "candidate",
      proposedLocalConfidence: "low",
    });
    expect(batch.records[0].sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(batch.records[0].displayFields).toEqual(stagedInvoice.displayFields);
  });

  it("keeps fingerprints stable for the same source-attributed review fields", () => {
    const first = fingerprintImportStagingRecord(stagedInvoice);
    const second = fingerprintImportStagingRecord({
      ...stagedInvoice,
      displayFields: [...stagedInvoice.displayFields],
    });

    expect(first).toBe(second);
  });

  it("does not preserve raw provider payloads in review records", () => {
    const batch = buildIntegrationImportReviewBatch({
      batchId: "quickbooks-2026-05-22T12-00-00Z",
      sourceProvider: "quickbooks",
      stagedRecords: [
        {
          ...stagedInvoice,
          displayFields: [
            ...stagedInvoice.displayFields,
            { label: "Access token", value: "secret-token" },
          ],
        },
      ],
    });

    expect(JSON.stringify(batch)).not.toContain("Rows");
    expect(JSON.stringify(batch)).not.toContain("refreshToken");
    expect(JSON.stringify(batch)).not.toContain("secret-token");
  });
});
