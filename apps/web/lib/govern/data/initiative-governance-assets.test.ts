import { describe, expect, it } from "vitest";

import { DATA_ASSET_REGISTRY, lookupAssetByPrismaModel, resolveField } from "./assets";

describe("initiative governance assets", () => {
  it("registers permanent initiative artifact retention as masked legal evidence", () => {
    expect(lookupAssetByPrismaModel(DATA_ASSET_REGISTRY, "InitiativeArtifactRetentionPin")).toMatchObject({
      id: "data:initiative-artifact-retention-pin",
      domain: "initiative-governance",
      sensitivity: "confidential",
      criticality: "high",
      lifecycleClass: "legal-evidence",
      residencyClass: "local-only",
      projectionClass: "masked-content",
    });
  });

  it("minimizes and masks the retained artifact locator", () => {
    expect(resolveField(
      DATA_ASSET_REGISTRY,
      "data:initiative-artifact-retention-pin#artifactLocator",
    )).toMatchObject({
      resolution: "governed",
      collectionRule: "minimize",
      protection: "mask-on-read",
      projectionOverride: "masked-content",
    });
  });
});
