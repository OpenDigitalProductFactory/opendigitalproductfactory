// apps/web/lib/govern/data/assets.test.ts
import { describe, expect, it } from "vitest";
import {
  DATA_ASSET_REGISTRY,
  DataAssetRegistryError,
  buildAssetRegistry,
  lookupAsset,
  lookupAssetByPrismaModel,
  resolveField,
  type DataAssetDefinition,
} from "./assets";

function baseAsset(overrides: Partial<DataAssetDefinition> = {}): DataAssetDefinition {
  return {
    id: "data:widget",
    physical: { prismaModel: "Widget" },
    domain: "operational",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["operational"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-17" },
    fields: [
      {
        id: "data:widget#name",
        physicalName: "name",
        resolution: "inherited",
        resolutionReason: "ordinary operational label",
        provenance: {
          source: "manual",
          state: "confirmed",
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-17",
        },
      },
    ],
    ...overrides,
  };
}

describe("buildAssetRegistry invariants", () => {
  it("indexes assets by id and prisma model", () => {
    const reg = buildAssetRegistry([baseAsset()]);
    expect(lookupAsset(reg, "data:widget")?.physical.prismaModel).toBe("Widget");
    expect(lookupAssetByPrismaModel(reg, "Widget")?.id).toBe("data:widget");
  });

  it("rejects duplicate asset ids", () => {
    expect(() => buildAssetRegistry([baseAsset(), baseAsset({ physical: { prismaModel: "W2" } })]))
      .toThrow(DataAssetRegistryError);
  });

  it("rejects two assets mapping to one prisma model", () => {
    expect(() => buildAssetRegistry([baseAsset(), baseAsset({ id: "data:widget-2" })]))
      .toThrow(/prisma model/);
  });

  it("rejects a field id that does not belong to its asset", () => {
    expect(() =>
      buildAssetRegistry([
        baseAsset({
          fields: [
            {
              id: "data:other#name",
              physicalName: "name",
              resolution: "inherited",
              resolutionReason: "x",
              provenance: {
                source: "manual",
                state: "confirmed",
                assertedBy: "data-steward",
                effectiveFrom: "2026-07-17",
              },
            },
          ],
        }),
      ]),
    ).toThrow(/does not belong/);
  });
});

describe("field resolution", () => {
  it("resolves a known field id to its definition", () => {
    const reg = buildAssetRegistry([baseAsset()]);
    expect(resolveField(reg, "data:widget#name")?.physicalName).toBe("name");
  });

  it("returns undefined for an unknown field", () => {
    const reg = buildAssetRegistry([baseAsset()]);
    expect(resolveField(reg, "data:widget#missing")).toBeUndefined();
  });
});

describe("seeded registry", () => {
  it("builds without invariant violations and carries the BI-DG-001 worked asset", () => {
    expect(DATA_ASSET_REGISTRY.assets.length).toBeGreaterThan(0);
    const conv = lookupAsset(DATA_ASSET_REGISTRY, "data:agent-conversation");
    expect(conv?.physical.prismaModel).toBe("AgentMessage");
    expect(resolveField(DATA_ASSET_REGISTRY, "data:agent-conversation#content")?.projectionOverride)
      .toBe("masked-content");
  });

  it("governs founder demand curation as confidential local business records", () => {
    const cluster = lookupAsset(DATA_ASSET_REGISTRY, "data:founder-demand-cluster");
    const member = lookupAsset(DATA_ASSET_REGISTRY, "data:founder-demand-cluster-member");
    expect(cluster).toMatchObject({
      physical: { prismaModel: "FounderDemandCluster" },
      sensitivity: "confidential",
      lifecycleClass: "business-record",
      residencyClass: "local-only",
      projectionClass: "masked-content",
    });
    expect(member?.physical.prismaModel).toBe("FounderDemandClusterMember");
  });

  it("governs nearby pairing as restricted local-only setup authority", () => {
    const pairing = lookupAsset(DATA_ASSET_REGISTRY, "data:federation-pairing-session");
    expect(pairing).toMatchObject({
      physical: { prismaModel: "FederationPairingSession" },
      sensitivity: "restricted",
      lifecycleClass: "security-audit",
      residencyClass: "local-only",
      projectionClass: "metadata",
    });
    expect(
      resolveField(DATA_ASSET_REGISTRY, "data:federation-pairing-session#pairingSecretEnc"),
    ).toMatchObject({
      collectionRule: "minimize",
      protection: "encrypt-and-mask",
      projectionOverride: "structure",
    });
    expect(
      resolveField(DATA_ASSET_REGISTRY, "data:federation-pairing-session#bootstrapTokenEnc"),
    ).toMatchObject({
      collectionRule: "minimize",
      protection: "encrypt-and-mask",
      projectionOverride: "structure",
    });
  });

  it("governs Edge Node certificate identity and lifecycle as restricted security evidence", () => {
    const certificate = lookupAsset(DATA_ASSET_REGISTRY, "data:edge-node-certificate");
    expect(certificate).toMatchObject({
      physical: { prismaModel: "EdgeNodeCertificate" },
      sensitivity: "restricted",
      criticality: "high",
      lifecycleClass: "security-audit",
      residencyClass: "local-only",
      projectionClass: "metadata",
    });
    expect(
      resolveField(DATA_ASSET_REGISTRY, "data:edge-node-certificate#fingerprintSha256"),
    ).toMatchObject({
      collectionRule: "minimize",
      protection: "mask-on-read",
      projectionOverride: "structure",
    });
    expect(
      resolveField(DATA_ASSET_REGISTRY, "data:edge-node-certificate#revokedAt"),
    ).toMatchObject({
      resolution: "governed",
      projectionOverride: "metadata",
    });
  });
});
