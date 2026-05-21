import { describe, it, expect, vi } from "vitest";

import { runConnectionCollectors, type ConnectionLoaderDb } from "./connection-collectors";

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

  it("skips unifi connections (BI-35de9ce8 — edge nodes own UniFi polling now)", async () => {
    // The portal still hosts the encrypted DiscoveryConnection row and
    // the one-shot test action; the recurring sweep is no longer its
    // job. Edge nodes pull adapter configs from GET /api/v1/edge/adapters.
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
    expect(result.items).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });

  it("skips non-unifi unknown collector types", async () => {
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
