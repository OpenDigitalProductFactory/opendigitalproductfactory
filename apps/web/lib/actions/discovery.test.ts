import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockFindUnique = vi.fn();
const mockCollectUnifiDiscovery = vi.fn();
const mockBuildDepsFromConnection = vi.fn();
const mockCollectArpScanDiscovery = vi.fn();
const mockCollectSnmpDiscovery = vi.fn();
const mockNormalizeDiscoveredFacts = vi.fn((value) => value);
const mockPersistBootstrapDiscoveryRun = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    discoveryConnection: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
  executeBootstrapDiscovery: vi.fn(),
  normalizeDiscoveredFacts: (value: unknown) => mockNormalizeDiscoveredFacts(value),
  persistBootstrapDiscoveryRun: (...args: unknown[]) => mockPersistBootstrapDiscoveryRun(...args),
}));
vi.mock("@dpf/db/discovery-collectors-unifi", () => ({
  collectUnifiDiscovery: (...args: unknown[]) => mockCollectUnifiDiscovery(...args),
  buildDepsFromConnection: (...args: unknown[]) => mockBuildDepsFromConnection(...args),
}));
vi.mock("@dpf/db/discovery-collectors-arp-scan", () => ({
  collectArpScanDiscovery: (...args: unknown[]) => mockCollectArpScanDiscovery(...args),
}));
vi.mock("@dpf/db/discovery-collectors-snmp", () => ({
  collectSnmpDiscovery: (...args: unknown[]) => mockCollectSnmpDiscovery(...args),
}));
vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptSecret: (plain: string) => `enc:${plain}`,
  decryptSecret: (enc: string) => enc.replace(/^enc:/, ""),
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { executeBootstrapDiscovery } from "@dpf/db";
import { configureDiscoveryConnection, rerunDiscoveryConnection, testDiscoveryConnection, triggerBootstrapDiscovery } from "./discovery";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockCan = can as ReturnType<typeof vi.fn>;
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;
const mockExecuteBootstrapDiscovery = executeBootstrapDiscovery as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { platformRole: "HR-000", isSuperuser: true } });
  mockCan.mockReturnValue(true);
  mockBuildDepsFromConnection.mockReturnValue({
    fetchFn: vi.fn(),
    unifiUrl: "https://192.168.0.1",
    apiKey: "key",
    site: "default",
    discoverClients: false,
    tlsInsecure: false,
  });
  mockCollectUnifiDiscovery.mockResolvedValue({ items: [], relationships: [] });
  mockCollectArpScanDiscovery.mockResolvedValue({ items: [], relationships: [] });
  mockCollectSnmpDiscovery.mockResolvedValue({ items: [], relationships: [] });
  mockPersistBootstrapDiscoveryRun.mockResolvedValue({
    runId: "run-1",
    createdEntities: 1,
    updatedEntities: 0,
    createdRelationships: 1,
    updatedRelationships: 0,
  });
});

describe("configureDiscoveryConnection — edit path", () => {
  it("uses update-by-id when an id is supplied (URL changes don't fork the row)", async () => {
    mockUpdate.mockResolvedValue({ id: "conn-1" });
    const result = await configureDiscoveryConnection({
      id: "conn-1",
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "192.168.1.1", // changed from .0.1 — must not orphan original row
      apiKey: "new-key",
      configuration: { site: "default", discoverClients: true },
    });
    expect(result).toEqual({ ok: true, connectionId: "conn-1" });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const call = mockUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: "conn-1" });
    expect(call.data.endpointUrl).toBe("https://192.168.1.1");
    expect(call.data.connectionKey).toBe("unifi:192.168.1.1");
    expect(call.data.encryptedApiKey).toBe("enc:new-key");
    expect(call.data.status).toBe("active");
  });

  it("preserves status when editing without a fresh key (URL/site rotation)", async () => {
    mockUpdate.mockResolvedValue({ id: "conn-1" });
    await configureDiscoveryConnection({
      id: "conn-1",
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "192.168.0.1",
      configuration: { site: "default", discoverClients: true },
    });
    const call = mockUpdate.mock.calls[0][0];
    expect(call.data).not.toHaveProperty("encryptedApiKey");
    expect(call.data).not.toHaveProperty("status");
  });

  it("updates collectorType when an existing row is changed to ARP scan", async () => {
    mockUpdate.mockResolvedValue({ id: "conn-1" });
    await configureDiscoveryConnection({
      id: "conn-1",
      name: "Subnet 192.168.0.0/24",
      collectorType: "arp_scan",
      endpointUrl: "192.168.0.0/24",
      configuration: { subnet: "192.168.0.0/24" },
    });
    const call = mockUpdate.mock.calls[0][0];
    expect(call.data.collectorType).toBe("arp_scan");
    expect(call.data.connectionKey).toBe("arp_scan:192.168.0.0/24");
    expect(call.data.endpointUrl).toBe("192.168.0.0/24");
  });

  it("rejects URL-shaped ARP subnet inputs before saving", async () => {
    await expect(configureDiscoveryConnection({
      id: "conn-1",
      name: "Subnet https://192.168.0.1",
      collectorType: "arp_scan",
      endpointUrl: "https://192.168.0.1",
      configuration: { subnet: "https://192.168.0.1" },
    })).resolves.toEqual({
      ok: false,
      error: "Enter a subnet in CIDR notation, for example 192.168.0.0/24.",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("falls back to upsert by connectionKey when id is omitted (create flow)", async () => {
    mockUpsert.mockResolvedValue({ id: "conn-fresh" });
    const result = await configureDiscoveryConnection({
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "192.168.0.1",
      apiKey: "fresh-key",
    });
    expect(result).toEqual({ ok: true, connectionId: "conn-fresh" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("uses the shared endpoint contract before persistence", async () => {
    const result = await configureDiscoveryConnection({
      gatewayEntityId: "gw-1",
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "file:///etc/passwd",
      apiKey: "fresh-key",
    });

    expect(result).toEqual({
      ok: false,
      error: "Use an HTTP or HTTPS gateway address.",
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("canonicalizes equivalent endpoints and preserves gateway identity", async () => {
    mockUpsert.mockResolvedValue({ id: "conn-fresh" });

    await configureDiscoveryConnection({
      gatewayEntityId: "gw-1",
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "  HTTP://192.168.0.1/  ",
      apiKey: "fresh-key",
    });

    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectionKey: "unifi:192.168.0.1" },
      create: expect.objectContaining({
        endpointUrl: "https://192.168.0.1",
        gatewayEntityId: "gw-1",
      }),
    }));
  });
});

describe("triggerBootstrapDiscovery", () => {
  it("denies rerun when the user lacks the required capability", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-300", isSuperuser: false },
    });
    mockCan.mockReturnValue(false);

    await expect(triggerBootstrapDiscovery()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("revalidates discovery surfaces after a successful bootstrap run", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });
    mockCan.mockReturnValue(true);
    mockExecuteBootstrapDiscovery.mockResolvedValue({ runKey: "DISC-200" });

    await expect(triggerBootstrapDiscovery()).resolves.toEqual({
      ok: true,
      summary: { runKey: "DISC-200" },
    });

    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/tools/discovery");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/inventory");
  });
});

describe("testDiscoveryConnection", () => {
  it("passes stored per-connection TLS policy into the one-shot UniFi test", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-1",
      endpointUrl: "https://192.168.0.1",
      encryptedApiKey: "enc:key",
      configuration: {
        site: "default",
        discoverClients: true,
        tlsInsecure: true,
      },
    });
    mockCollectUnifiDiscovery.mockResolvedValue({
      items: [{ itemType: "router" }],
      relationships: [],
    });
    mockUpdate.mockResolvedValue({ id: "conn-1" });

    await expect(testDiscoveryConnection("conn-1")).resolves.toEqual({
      ok: true,
      status: "ok",
      deviceCount: 1,
    });

    expect(mockBuildDepsFromConnection).toHaveBeenCalledWith({
      endpointUrl: "https://192.168.0.1",
      apiKey: "key",
      configuration: {
        site: "default",
        discoverClients: false,
        tlsInsecure: true,
      },
    });
  });

  it("marks a reachable UniFi connection with zero devices as degraded", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-empty",
      collectorType: "unifi",
      endpointUrl: "https://192.168.0.1",
      encryptedApiKey: "enc:key",
      configuration: { site: "default" },
    });
    mockCollectUnifiDiscovery.mockResolvedValue({
      items: [],
      relationships: [],
      warnings: ["unifi_no_devices"],
    });
    mockUpdate.mockResolvedValue({ id: "conn-empty" });

    await expect(testDiscoveryConnection("conn-empty")).resolves.toEqual({
      ok: true,
      status: "unifi_no_devices",
      message: expect.stringContaining("returned no managed network devices"),
    });
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      lastTestStatus: "unifi_no_devices",
      status: "degraded",
    });
  });

  it("tests ARP scan connections with the ARP collector instead of UniFi", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-arp",
      collectorType: "arp_scan",
      endpointUrl: "192.168.0.0/24",
      encryptedApiKey: null,
      configuration: { subnet: "192.168.0.0/24" },
    });
    mockCollectArpScanDiscovery.mockResolvedValue({
      items: [{ itemType: "host" }, { itemType: "subnet" }],
      relationships: [],
    });
    mockUpdate.mockResolvedValue({ id: "conn-arp" });

    await expect(testDiscoveryConnection("conn-arp")).resolves.toEqual({
      ok: true,
      status: "ok",
      deviceCount: 2,
      message: "Discovered 2 items",
    });

    expect(mockCollectUnifiDiscovery).not.toHaveBeenCalled();
    expect(mockCollectArpScanDiscovery).toHaveBeenCalledWith(
      { sourceKind: "arp_scan" },
      [{ subnet: "192.168.0.0/24" }],
    );
  });

  it("tests SNMP connections with the SNMP collector and configured community", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-snmp",
      collectorType: "snmp",
      endpointUrl: "192.168.0.1",
      encryptedApiKey: null,
      configuration: { community: "public" },
    });
    mockCollectSnmpDiscovery.mockResolvedValue({
      items: [{ itemType: "host" }],
      relationships: [],
    });
    mockUpdate.mockResolvedValue({ id: "conn-snmp" });

    await expect(testDiscoveryConnection("conn-snmp")).resolves.toEqual({
      ok: true,
      status: "ok",
      deviceCount: 1,
      message: "Discovered 1 item",
    });

    expect(mockCollectUnifiDiscovery).not.toHaveBeenCalled();
    expect(mockCollectSnmpDiscovery).toHaveBeenCalledWith(
      { sourceKind: "snmp" },
      [{ address: "192.168.0.1", community: "public" }],
    );
  });
});

describe("rerunDiscoveryConnection", () => {
  it("preserves the stored TLS policy and does not persist an empty UniFi sweep", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-empty",
      connectionKey: "unifi:192.168.0.1",
      collectorType: "unifi",
      status: "active",
      endpointUrl: "https://192.168.0.1",
      encryptedApiKey: "enc:key",
      configuration: { site: "default", discoverClients: true, tlsInsecure: true },
    });
    mockCollectUnifiDiscovery.mockResolvedValue({
      items: [],
      relationships: [],
      warnings: ["unifi_no_devices"],
    });

    await expect(rerunDiscoveryConnection("conn-empty")).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("returned no managed network devices"),
    });
    expect(mockBuildDepsFromConnection).toHaveBeenCalledWith(expect.objectContaining({
      configuration: { site: "default", discoverClients: true, tlsInsecure: true },
    }));
    expect(mockPersistBootstrapDiscoveryRun).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      lastTestStatus: "unifi_no_devices",
      status: "degraded",
    });
  });

  it("persists partial physical results while keeping the connection degraded", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-partial",
      connectionKey: "unifi:192.168.0.1",
      collectorType: "unifi",
      status: "active",
      endpointUrl: "https://192.168.0.1",
      encryptedApiKey: "enc:key",
      configuration: { site: "default" },
    });
    mockCollectUnifiDiscovery.mockResolvedValue({
      items: [{ itemType: "router" }],
      relationships: [],
      warnings: ["unifi_partial:device_detail:gw-1"],
    });

    await expect(rerunDiscoveryConnection("conn-partial")).resolves.toMatchObject({
      ok: true,
      status: "degraded",
    });
    expect(mockPersistBootstrapDiscoveryRun).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      lastTestStatus: "unifi_partial",
      status: "degraded",
    });
  });
});
