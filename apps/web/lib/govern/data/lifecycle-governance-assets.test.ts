import { describe, expect, it } from "vitest";
import {
  DATA_ASSET_REGISTRY,
  lookupAsset,
  lookupAssetByPrismaModel,
  resolveField,
} from "./assets";

describe("lifecycle governance assets", () => {
  it("registers every lifecycle backbone model with its intended policy", () => {
    expect(lookupAssetByPrismaModel(DATA_ASSET_REGISTRY, "LifecycleEvent")).toMatchObject({
      id: "data:lifecycle-event",
      sensitivity: "confidential",
      lifecycleClass: "legal-evidence",
      projectionClass: "masked-content",
    });
    expect(lookupAssetByPrismaModel(DATA_ASSET_REGISTRY, "PlateauMembership")).toMatchObject({
      id: "data:plateau-membership",
      sensitivity: "internal",
      lifecycleClass: "operational",
      projectionClass: "metadata",
    });
    expect(lookupAssetByPrismaModel(DATA_ASSET_REGISTRY, "LifecycleGap")).toMatchObject({
      id: "data:lifecycle-gap",
      sensitivity: "internal",
      lifecycleClass: "business-record",
      projectionClass: "metadata",
    });
  });

  it("masks accountable actor and free-form transition evidence", () => {
    expect(lookupAsset(DATA_ASSET_REGISTRY, "data:lifecycle-event")).toBeDefined();
    for (const fieldId of [
      "data:lifecycle-event#actorPrincipalId",
      "data:lifecycle-event#reason",
      "data:lifecycle-event#evidenceRef",
    ] as const) {
      expect(resolveField(DATA_ASSET_REGISTRY, fieldId)).toMatchObject({
        resolution: "governed",
        collectionRule: "minimize",
        protection: "mask-on-read",
      });
    }
  });
});
