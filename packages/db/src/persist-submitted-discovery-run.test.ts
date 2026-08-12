import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DiscoverySyncClient,
  DiscoveryPersistenceSummary,
} from "./discovery-sync";
import type { CollectorOutput } from "./discovery-types";
import { persistSubmittedDiscoveryRun } from "./persist-submitted-discovery-run";

// We mock at the module-graph layer so the test exercises the wrapper's
// behavior (sourceSlug, trigger, edgeNodeId threading) without pulling
// the real persistBootstrapDiscoveryRun (which would need a real DB).

vi.mock("./discovery-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./discovery-sync")>();
  return {
    ...actual,
    persistBootstrapDiscoveryRun: vi.fn(),
  };
});

import { persistBootstrapDiscoveryRun } from "./discovery-sync";

const persistMock = persistBootstrapDiscoveryRun as unknown as ReturnType<
  typeof vi.fn
>;

const fakeDb = {
  $transaction: vi.fn(),
} as unknown as DiscoverySyncClient;

const summary: DiscoveryPersistenceSummary = {
  createdEntities: 1,
  updatedEntities: 0,
  staleEntities: 0,
  createdRelationships: 0,
  updatedRelationships: 0,
  staleRelationships: 0,
  createdIssues: 0,
  runId: "run_cuid_1",
};

const sampleOutput: CollectorOutput = {
  items: [
    {
      sourceKind: "host",
      itemType: "host",
      name: "edge-host-1",
      externalRef: "host:edge-host-1",
      naturalKey: "host:edge-host-1",
      confidence: 0.9,
      attributes: { os: "linux" },
    },
  ],
  relationships: [],
};

beforeEach(() => {
  // Reset call history but preserve the mock implementation registered
  // at module-load time. mockResolvedValueOnce in each test re-arms.
  persistMock.mockReset();
});

describe("persistSubmittedDiscoveryRun", () => {
  it("threads edgeNodeId and customer scope through to persistBootstrapDiscoveryRun's runMeta", async () => {
    persistMock.mockResolvedValueOnce(summary);

    const result = await persistSubmittedDiscoveryRun(fakeDb, {
      edgeNodeId: "edgenode_cuid_42",
      nodeId: "edge_a1b2c3",
      runKey: "run_idempotent_42",
      customerAccountId: "cust_acme",
      customerSiteId: "site_hq",
      submittedOutput: sampleOutput,
    });

    expect(result).toEqual(summary);
    expect(persistMock).toHaveBeenCalledOnce();

    const call = persistMock.mock.calls[0]!;
    const dbArg = call[0];
    const normalizedArg = call[1];
    const runMetaArg = call[2];

    expect(dbArg).toBe(fakeDb);
    // The normalize step ran — at minimum, discoveredItems should reflect
    // the one input item.
    expect(normalizedArg.discoveredItems.length).toBe(1);
    expect(normalizedArg.discoveredItems[0]?.name).toBe("edge-host-1");

    expect(runMetaArg).toMatchObject({
      runKey: "run_idempotent_42",
      sourceSlug: "edge-node:edge_a1b2c3",
      trigger: "edge_node",
      status: "completed",
      edgeNodeId: "edgenode_cuid_42",
      customerAccountId: "cust_acme",
      customerSiteId: "site_hq",
    });
  });

  it("produces a sourceSlug that encodes the nodeId for filterability", async () => {
    persistMock.mockResolvedValueOnce(summary);

    await persistSubmittedDiscoveryRun(fakeDb, {
      edgeNodeId: "edgenode_x",
      nodeId: "edge_zzzzzz",
      runKey: "run_zzz",
      submittedOutput: sampleOutput,
    });

    const meta = persistMock.mock.calls[0]?.[2];
    expect(meta?.sourceSlug).toBe("edge-node:edge_zzzzzz");
  });

  it("uses the 'edge_node' trigger so audit can distinguish ingestion source", async () => {
    persistMock.mockResolvedValueOnce(summary);

    await persistSubmittedDiscoveryRun(fakeDb, {
      edgeNodeId: "edgenode_y",
      nodeId: "edge_yyyyyy",
      runKey: "run_yyy",
      submittedOutput: sampleOutput,
    });

    const meta = persistMock.mock.calls[0]?.[2];
    expect(meta?.trigger).toBe("edge_node");
    // NOT "bootstrap" — that's the existing manual / portal-resident path.
    expect(meta?.trigger).not.toBe("bootstrap");
  });

  it("loads active fingerprint rules from the db and identifies a known-vendor host (regression: BI-BAF38ED3)", async () => {
    // Regression for the wiring break: the edge-node ingestion path normalized
    // WITHOUT loading fingerprint rules / taxonomy, so every ARP host fell
    // through to the coarse `host -> /servers` rule. A Whirlpool appliance must
    // be fingerprinted to the smart-appliance node, not filed as a server.
    persistMock.mockResolvedValueOnce(summary);

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

    // A db that can answer the loader's findMany calls in addition to $transaction.
    const dbWithRules = {
      $transaction: vi.fn(),
      taxonomyNode: {
        findMany: vi.fn(async () => [
          { nodeId: applianceNodeId, name: "Smart Home & Appliances", description: null, enrichment: null },
          { nodeId: "foundational/compute/servers", name: "Servers", description: null, enrichment: null },
        ]),
      },
      discoveryFingerprintRule: {
        findMany: vi.fn(async () => [whirlpoolRule]),
      },
    } as unknown as DiscoverySyncClient;

    const whirlpoolOutput: CollectorOutput = {
      items: [
        {
          sourceKind: "host",
          itemType: "host",
          name: "Whirlpool 192.168.0.91",
          externalRef: "host:whirlpool-91",
          naturalKey: "host:whirlpool-91",
          confidence: 0.9,
          attributes: { vendor: "Whirlpool", mac: "88:e7:12:00:00:91" },
        },
      ],
      relationships: [],
    };

    await persistSubmittedDiscoveryRun(dbWithRules, {
      edgeNodeId: "edgenode_arp",
      nodeId: "edge_arp_1",
      runKey: "run_whirlpool",
      submittedOutput: whirlpoolOutput,
    });

    const normalizedArg = persistMock.mock.calls[0]?.[1];
    const entity = normalizedArg.inventoryEntities[0];
    // The fix: fingerprinted to the appliance node with a resolved identity,
    // NOT the coarse `host -> /servers` fallback.
    expect(entity?.taxonomyNodeId).toBe(applianceNodeId);
    expect(entity?.taxonomyNodeId).not.toMatch(/\/servers$/);
    expect(entity?.identityStatus).toBe("rule_resolved");
    expect(entity?.catalogIdentityId).toBe("catid_whirlpool");
  });

  it("forwards options through (e.g. test-injected projectors)", async () => {
    persistMock.mockResolvedValueOnce(summary);
    const fakeProjector = vi.fn(async () => ({}) as never);

    await persistSubmittedDiscoveryRun(
      fakeDb,
      {
        edgeNodeId: "edgenode_z",
        nodeId: "edge_zzz",
        runKey: "run_options",
        submittedOutput: sampleOutput,
      },
      {
        projectInventoryEntity: fakeProjector,
      },
    );

    const optsArg = persistMock.mock.calls[0]?.[3];
    expect(optsArg).toEqual({ projectInventoryEntity: fakeProjector });
  });
});
