import { describe, expect, it } from "vitest";
import { DATA_ASSET_REGISTRY, lookupAssetByPrismaModel } from "./assets";

describe("AI provider governance assets", () => {
  it("governs durable async inference transition history as confidential audit data", () => {
    const asset =
      lookupAssetByPrismaModel(
        DATA_ASSET_REGISTRY,
        "AsyncInferenceOperationTransition",
      );

    expect(asset).toMatchObject({
      id: "data:async-inference-operation-transition",
      domain: "ai-provider-governance",
      sensitivity: "confidential",
      criticality: "high",
      lifecycleClass: "operational",
      projectionClass: "metadata",
    });
    expect(asset?.fields.map((field) => field.physicalName)).toEqual([
      "id",
      "operationId",
      "sequence",
      "status",
      "checkpoint",
      "occurredAt",
      "deliveryAttempts",
      "deliveredAt",
      "operation",
    ]);
    expect(
      Object.fromEntries(asset?.fields.map((field) => [field.physicalName, field.resolution]) ?? []),
    ).toEqual({
      id: "inherited",
      operationId: "inherited",
      sequence: "inherited",
      status: "inherited",
      checkpoint: "governed",
      occurredAt: "governed",
      deliveryAttempts: "governed",
      deliveredAt: "governed",
      operation: "inherited",
    });
  });
});
