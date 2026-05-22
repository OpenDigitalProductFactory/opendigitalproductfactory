import { describe, expect, it, vi } from "vitest";
import { getLatestCycloneDxForProduct } from "./bom-export";

describe("getLatestCycloneDxForProduct", () => {
  it("returns null when the product has no BOM", async () => {
    const db = { bomDocument: { findFirst: vi.fn(async () => null) } };

    await expect(getLatestCycloneDxForProduct(db, "product-1")).resolves.toBeNull();
  });

  it("returns a shareable CycloneDX document for the newest product BOM", async () => {
    const db = {
      bomDocument: {
        findFirst: vi.fn(async () => ({
          documentId: "bom_1",
          raw: {
            bomFormat: "CycloneDX",
            specVersion: "1.7",
            serialNumber: "urn:uuid:test",
            version: 1,
            metadata: { properties: [{ name: "dpf:workspacePath", value: "D:/DPF/apps/web" }] },
            components: [{ name: "next", version: "16.2.6" }],
            dependencies: [],
          },
        })),
      },
    };

    const result = await getLatestCycloneDxForProduct(db, "product-1");

    expect(result?.documentId).toBe("bom_1");
    expect(JSON.stringify(result?.raw)).not.toContain("workspacePath");
    expect(db.bomDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { digitalProductId: "product-1" },
      orderBy: { generatedAt: "desc" },
    }));
  });
});
