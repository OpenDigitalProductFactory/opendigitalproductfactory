import { describe, it, expect, vi } from "vitest";

import { runConnectionCollectors, type ConnectionLoaderDb } from "./connection-collectors";

// Mock the UniFi collector
vi.mock("../discovery-collectors/unifi", () => ({
  collectUnifiDiscovery: vi.fn().mockResolvedValue({
    items: [
      {
        sourceKind: "unifi",
        itemType: "router",
        name: "UDM Pro",
        externalRef: "unifi-device:aa:bb:cc:dd:ee:01",
      },
    ],
    relationships: [],
    software: [],
    warnings: [],
  }),
  buildDepsFromConnection: vi.fn().mockReturnValue({
    fetchFn: vi.fn(),
    unifiUrl: "https://192.168.0.1",
    apiKey: "decrypted-key",
    site: "default",
    discoverClients: false,
  }),
}));

function makeMockDb(connections: Array<{
  id: string;
  connectionKey: string;
  collectorType: string;
  endpointUrl: string;
  encryptedApiKey: string | null;
  configuration: unknown;
  status: string;
}> = []): ConnectionLoaderDb {
  return {
    discoveryConnection: {
      findMany: vi.fn().mockResolvedValue(connections),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

const mockDecrypt = (encrypted: string) => encrypted === "bad" ? null : `decrypted:${encrypted}`;

describe("runConnectionCollectors", () => {
  it("returns empty output when no active connections", async () => {
    const db = makeMockDb([]);
    const result = await runConnectionCollectors(db, mockDecrypt);

    expect(result.items).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });

  it("runs UniFi collector for active unifi connections", async () => {
    const db = makeMockDb([
      {
        id: "conn-1",
        connectionKey: "unifi:192.168.0.1",
        collectorType: "unifi",
        endpointUrl: "https://192.168.0.1",
        encryptedApiKey: "enc:test-key",
        configuration: { site: "default" },
        status: "active",
      },
    ]);

    const result = await runConnectionCollectors(db, mockDecrypt);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].itemType).toBe("router");
  });

  it("skips connections without API key", async () => {
    const db = makeMockDb([
      {
        id: "conn-2",
        connectionKey: "unifi:10.0.0.1",
        collectorType: "unifi",
        endpointUrl: "https://10.0.0.1",
        encryptedApiKey: null,
        configuration: {},
        status: "active",
      },
    ]);

    const result = await runConnectionCollectors(db, mockDecrypt);
    expect(result.items).toHaveLength(0);
  });

  it("skips when decrypt fails and returns empty output", async () => {
    const db = makeMockDb([
      {
        id: "conn-3",
        connectionKey: "unifi:10.0.0.2",
        collectorType: "unifi",
        endpointUrl: "https://10.0.0.2",
        encryptedApiKey: "bad",
        configuration: {},
        status: "active",
      },
    ]);

    const result = await runConnectionCollectors(db, mockDecrypt);

    expect(result.items).toHaveLength(0);
  });

  it("skips non-unifi collector types", async () => {
    const db = makeMockDb([
      {
        id: "conn-4",
        connectionKey: "meraki:10.0.0.3",
        collectorType: "meraki",
        endpointUrl: "https://10.0.0.3",
        encryptedApiKey: "enc:key",
        configuration: {},
        status: "active",
      },
    ]);

    const result = await runConnectionCollectors(db, mockDecrypt);
    expect(result.items).toHaveLength(0);
  });

  it("gracefully handles missing table (pre-migration)", async () => {
    const db: ConnectionLoaderDb = {
      discoveryConnection: {
        findMany: vi.fn().mockRejectedValue(new Error("relation does not exist")),
        update: vi.fn(),
      },
    };

    const result = await runConnectionCollectors(db, mockDecrypt);
    expect(result.items).toHaveLength(0);
  });
});
