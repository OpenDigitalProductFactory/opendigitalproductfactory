import { describe, expect, it, vi } from "vitest";
import { persistGeneratedBom } from "./bom-persistence";
import type { GeneratedBom } from "./bom-types";

const generatedBom: GeneratedBom = {
  cyclonedx: {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: "urn:uuid:test",
    version: 1,
    metadata: {},
    components: [],
    dependencies: [],
  },
  components: [
    {
      componentKey: "component-1",
      componentType: "library",
      name: "next",
      version: "16.2.6",
      packageUrl: "pkg:npm/next@16.2.6",
      supplierName: null,
      licenseExpression: null,
      ecosystem: "npm",
      scope: "required",
      metadata: {},
    },
  ],
  occurrences: [
    {
      occurrenceKey: "occurrence-1",
      componentKey: "component-1",
      workspaceName: "web",
      workspacePath: "apps/web",
      dependencyKind: "dependencies",
      direct: true,
      evidence: {},
    },
  ],
  sourceDigest: "source-digest",
  documentDigest: "document-digest",
};

describe("persistGeneratedBom", () => {
  it("persists document, components, and occurrences through stable keys", async () => {
    const db = {
      bomComponent: {
        upsert: vi.fn(async () => ({ id: "db-component-1", componentKey: "component-1" })),
      },
      bomDocument: {
        upsert: vi.fn(async () => ({ id: "db-document-1", documentId: "bom_document-digest" })),
      },
      bomComponentOccurrence: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    const result = await persistGeneratedBom(db, {
      buildId: "BUILD-1",
      digitalProductId: "product-1",
      assuranceRunId: "run-1",
      generatedBom,
    });

    expect(result.documentId).toBe("bom_document-digest");
    expect(db.bomComponent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { componentKey: "component-1" },
    }));
    expect(db.bomDocument.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { documentId: "bom_document-digest" },
      create: expect.objectContaining({
        digest: "document-digest",
        raw: generatedBom.cyclonedx,
      }),
      update: expect.objectContaining({
        digest: "document-digest",
        raw: generatedBom.cyclonedx,
      }),
    }));
    expect(db.bomComponentOccurrence.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ occurrenceKey: "occurrence-1" })],
      skipDuplicates: true,
    }));
  });
});
