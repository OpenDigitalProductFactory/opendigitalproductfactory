import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the prisma singleton the backfill imports. The same mock object answers
// the loader's taxonomyNode/discoveryFingerprintRule queries AND the backfill's
// inventoryEntity queries.
type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };
// vi.hoisted so these spies exist before the hoisted vi.mock factory runs.
const { findManyEntities, updateEntity } = vi.hoisted(() => ({
  findManyEntities: vi.fn<() => Promise<unknown[]>>(),
  updateEntity: vi.fn<(args: UpdateArgs) => Promise<unknown>>(async () => ({})),
}));

const applianceNodeId = "foundational/building_management/smart_home_and_appliances";
const whirlpoolRule = {
  id: "rule_whirlpool",
  ruleKey: "estate:whirlpool-appliance",
  status: "active",
  matchExpression: { all: [{ type: "contains", path: "vendor", value: "whirlpool" }] },
  requiredEvidenceFamilies: ["mac_oui"],
  identityConfidence: 0.95,
  taxonomyConfidence: 0.95,
  resolvedIdentity: { kind: "device", vendor: "Whirlpool", deviceClass: "smart_appliance" },
  catalogIdentityId: "catid_whirlpool",
  taxonomyNode: { nodeId: applianceNodeId },
};

vi.mock("./client", () => ({
  prisma: {
    taxonomyNode: {
      findMany: vi.fn(async () => [
        { nodeId: applianceNodeId, name: "Smart Home & Appliances", description: null, enrichment: null },
        { nodeId: "foundational/compute/servers", name: "Servers", description: null, enrichment: null },
      ]),
    },
    discoveryFingerprintRule: {
      findMany: vi.fn(async () => [whirlpoolRule]),
    },
    inventoryEntity: {
      findMany: findManyEntities,
      update: updateEntity,
    },
  },
}));

import { backfillDiscoveryAttribution } from "./discovery-attribution-backfill";

beforeEach(() => {
  findManyEntities.mockReset();
  updateEntity.mockReset();
  updateEntity.mockResolvedValue({});
});

describe("backfillDiscoveryAttribution", () => {
  it("re-identifies a mis-binned known-vendor host via the fingerprint layer", async () => {
    findManyEntities.mockResolvedValueOnce([
      {
        id: "e1",
        entityType: "host",
        entityKey: "organization:internal:host:arp:88E712000091",
        name: "Whirlpool 192.168.0.91",
        properties: { vendor: "Whirlpool", mac: "88:e7:12:00:00:91" },
        attributionStatus: "attributed",
        attributionMethod: "rule",
        catalogIdentityId: null,
        identityStatus: null,
        taxonomyNode: { nodeId: "foundational/compute/servers" },
        portfolio: { slug: "foundational" },
      },
    ]);

    const report = await backfillDiscoveryAttribution();

    expect(report.fingerprinted).toBe(1);
    expect(report.demotedToReview).toBe(0);
    expect(updateEntity).toHaveBeenCalledOnce();
    const data = updateEntity.mock.calls[0]![0].data;
    expect(data.taxonomyNode).toEqual({ connect: { nodeId: applianceNodeId } });
    expect(data.catalogIdentity).toEqual({ connect: { id: "catid_whirlpool" } });
    expect(data.identityStatus).toBe("rule_resolved");
    expect(data.attributionStatus).toBe("attributed");
  });

  it("is idempotent: an already-healed row is not written again", async () => {
    findManyEntities.mockResolvedValueOnce([
      {
        id: "e1",
        entityType: "host",
        entityKey: "organization:internal:host:arp:88E712000091",
        name: "Whirlpool 192.168.0.91",
        properties: { vendor: "Whirlpool", mac: "88:e7:12:00:00:91" },
        attributionStatus: "attributed",
        attributionMethod: "rule",
        catalogIdentityId: "catid_whirlpool",
        identityStatus: "rule_resolved",
        taxonomyNode: { nodeId: applianceNodeId },
        portfolio: { slug: "foundational" },
      },
    ]);

    const report = await backfillDiscoveryAttribution();

    expect(report.fingerprinted).toBe(0);
    expect(report.skipped).toBe(1);
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it("demotes a bare no-evidence host that was filed as a confident server", async () => {
    findManyEntities.mockResolvedValueOnce([
      {
        id: "e2",
        entityType: "host",
        entityKey: "organization:internal:host:arp:0A0000000073",
        name: "LAN Host 192.168.0.73",
        properties: { mac: "0a:00:00:00:00:73" }, // no vendor match, no OS/compute signal
        attributionStatus: "attributed",
        attributionMethod: "rule",
        catalogIdentityId: null,
        identityStatus: null,
        taxonomyNode: { nodeId: "foundational/compute/servers" },
        portfolio: { slug: "foundational" },
      },
    ]);

    const report = await backfillDiscoveryAttribution();

    expect(report.demotedToReview).toBe(1);
    const data = updateEntity.mock.calls[0]![0].data;
    expect(data.attributionStatus).toBe("needs_review");
    expect(data.taxonomyNode).toEqual({ disconnect: true });
  });

  it("leaves a real compute host (OS signal) as an attributed server", async () => {
    findManyEntities.mockResolvedValueOnce([
      {
        id: "e3",
        entityType: "host",
        entityKey: "host:hostname:app-01",
        name: "app-01",
        properties: { os: "ubuntu 22.04" },
        attributionStatus: "attributed",
        attributionMethod: "rule",
        catalogIdentityId: null,
        identityStatus: null,
        taxonomyNode: { nodeId: "foundational/compute/servers" },
        portfolio: { slug: "foundational" },
      },
    ]);

    const report = await backfillDiscoveryAttribution();

    expect(report.demotedToReview).toBe(0);
    expect(report.skipped).toBe(1);
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it("dryRun previews the heal without writing any row", async () => {
    findManyEntities.mockResolvedValueOnce([
      {
        id: "e1",
        entityType: "host",
        entityKey: "organization:internal:host:arp:88E712000091",
        name: "Whirlpool 192.168.0.91",
        properties: { vendor: "Whirlpool", mac: "88:e7:12:00:00:91" },
        attributionStatus: "attributed",
        attributionMethod: "rule",
        catalogIdentityId: null,
        identityStatus: null,
        taxonomyNode: { nodeId: "foundational/compute/servers" },
        portfolio: { slug: "foundational" },
      },
    ]);

    const report = await backfillDiscoveryAttribution({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.fingerprinted).toBe(1); // counted as intent
    expect(updateEntity).not.toHaveBeenCalled(); // but nothing written
  });

  it("skips DPF-instance contained internals", async () => {
    findManyEntities.mockResolvedValueOnce([
      {
        id: "e4",
        entityType: "container",
        entityKey: "container:bd02d3f03235",
        name: "bd02d3f03235",
        properties: {},
        attributionStatus: "attributed",
        attributionMethod: "rule",
        catalogIdentityId: null,
        identityStatus: null,
        taxonomyNode: { nodeId: "foundational/platform_services/container_platform" },
        portfolio: { slug: "foundational" },
      },
    ]);

    const report = await backfillDiscoveryAttribution();

    expect(report.skipped).toBe(1);
    expect(updateEntity).not.toHaveBeenCalled();
  });
});
