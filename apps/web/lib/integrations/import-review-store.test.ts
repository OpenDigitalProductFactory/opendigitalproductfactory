import { describe, expect, it, vi } from "vitest";
import type { IntegrationImportReviewBatch } from "./import-review";
import { saveIntegrationImportReviewBatch } from "./import-review-store";

const reviewBatch: IntegrationImportReviewBatch = {
  batchId: "quickbooks-review-2026-05-22",
  sourceProvider: "quickbooks",
  providerEnvironment: "sandbox",
  sourceTimestamp: "2026-05-22T12:00:00.000Z",
  status: "reviewing",
  records: [
    {
      entityFamily: "invoices",
      externalId: "invoice-1",
      sourceProvider: "quickbooks",
      sourceTimestamp: "2026-05-22T11:00:00.000Z",
      ownerSide: "external",
      reviewStatus: "candidate",
      proposedLocalEntityType: "Invoice",
      proposedLocalId: null,
      proposedLocalStatus: "candidate",
      proposedLocalConfidence: "low",
      proposedLocalReason: "Review before linking.",
      displayFields: [{ label: "Invoice number", value: "INV-1001" }],
      sourceFingerprint: "a".repeat(64),
      readOnly: true,
    },
  ],
};

describe("import review persistence", () => {
  it("upserts a batch by batchRef and replaces read-only review records", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "batch-1" });
    const db = {
      integrationImportBatch: {
        upsert,
      },
    };

    await saveIntegrationImportReviewBatch(db, reviewBatch);

    expect(upsert).toHaveBeenCalledWith({
      where: { batchRef: "quickbooks-review-2026-05-22" },
      create: {
        batchRef: "quickbooks-review-2026-05-22",
        sourceProvider: "quickbooks",
        providerEnvironment: "sandbox",
        sourceTimestamp: new Date("2026-05-22T12:00:00.000Z"),
        status: "reviewing",
        records: {
          create: [
            {
              entityFamily: "invoices",
              externalId: "invoice-1",
              sourceProvider: "quickbooks",
              sourceTimestamp: new Date("2026-05-22T11:00:00.000Z"),
              ownerSide: "external",
              reviewStatus: "candidate",
              proposedLocalEntityType: "Invoice",
              proposedLocalId: null,
              proposedLocalStatus: "candidate",
              proposedLocalConfidence: "low",
              proposedLocalReason: "Review before linking.",
              displayFields: [{ label: "Invoice number", value: "INV-1001" }],
              sourceFingerprint: "a".repeat(64),
              readOnly: true,
            },
          ],
        },
      },
      update: {
        sourceProvider: "quickbooks",
        providerEnvironment: "sandbox",
        sourceTimestamp: new Date("2026-05-22T12:00:00.000Z"),
        status: "reviewing",
        records: {
          deleteMany: {},
          create: [
            {
              entityFamily: "invoices",
              externalId: "invoice-1",
              sourceProvider: "quickbooks",
              sourceTimestamp: new Date("2026-05-22T11:00:00.000Z"),
              ownerSide: "external",
              reviewStatus: "candidate",
              proposedLocalEntityType: "Invoice",
              proposedLocalId: null,
              proposedLocalStatus: "candidate",
              proposedLocalConfidence: "low",
              proposedLocalReason: "Review before linking.",
              displayFields: [{ label: "Invoice number", value: "INV-1001" }],
              sourceFingerprint: "a".repeat(64),
              readOnly: true,
            },
          ],
        },
      },
      include: { records: true },
    });
  });
});
