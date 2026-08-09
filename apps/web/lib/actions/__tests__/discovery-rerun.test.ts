import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCan, mockPrisma, mockDecryptSecret, mockCollectUnifi, mockBuildDeps, mockNormalize, mockPersistRun } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockPrisma: {
    discoveryConnection: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockDecryptSecret: vi.fn(),
  mockCollectUnifi: vi.fn(),
  mockBuildDeps: vi.fn(),
  mockNormalize: vi.fn(),
  mockPersistRun: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  normalizeDiscoveredFacts: mockNormalize,
  persistBootstrapDiscoveryRun: mockPersistRun,
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  encryptSecret: vi.fn(),
  decryptSecret: mockDecryptSecret,
}));

vi.mock("@dpf/db/discovery-collectors-unifi", () => ({
  collectUnifiDiscovery: mockCollectUnifi,
  buildDepsFromConnection: mockBuildDeps,
}));

import { rerunDiscoveryConnection } from "../discovery";

const authorizedSession = {
  user: { id: "user-1", platformRole: "IT-000", isSuperuser: true },
};

const baseConnection = {
  id: "conn-1",
  connectionKey: "unifi:192.168.0.1",
  collectorType: "unifi",
  endpointUrl: "https://192.168.0.1",
  encryptedApiKey: "enc-key",
  configuration: { site: "default" },
  status: "active",
};

describe("rerunDiscoveryConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when unauthorized", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await rerunDiscoveryConnection("conn-1");

    expect(result).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns error when requireManageDiscovery fails", async () => {
    mockAuth.mockResolvedValue(authorizedSession);
    mockCan.mockReturnValue(false);

    const result = await rerunDiscoveryConnection("conn-1");

    expect(result).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns error when connection not found", async () => {
    mockAuth.mockResolvedValue(authorizedSession);
    mockCan.mockReturnValue(true);
    mockPrisma.discoveryConnection.findUnique.mockResolvedValue(null);

    const result = await rerunDiscoveryConnection("conn-does-not-exist");

    expect(result).toEqual({ ok: false, error: "Connection not found" });
  });

  it("returns error when status is unconfigured", async () => {
    mockAuth.mockResolvedValue(authorizedSession);
    mockCan.mockReturnValue(true);
    mockPrisma.discoveryConnection.findUnique.mockResolvedValue({
      ...baseConnection,
      status: "unconfigured",
      encryptedApiKey: null,
    });

    const result = await rerunDiscoveryConnection("conn-1");

    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; error: string }).error).toContain("unconfigured");
  });

  it("returns error when status is auth_failed", async () => {
    mockAuth.mockResolvedValue(authorizedSession);
    mockCan.mockReturnValue(true);
    mockPrisma.discoveryConnection.findUnique.mockResolvedValue({
      ...baseConnection,
      status: "auth_failed",
    });

    const result = await rerunDiscoveryConnection("conn-1");

    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; error: string }).error).toContain("auth_failed");
  });

  it("returns success with discovery summary", async () => {
    mockAuth.mockResolvedValue(authorizedSession);
    mockCan.mockReturnValue(true);
    mockPrisma.discoveryConnection.findUnique.mockResolvedValue(baseConnection);
    mockDecryptSecret.mockReturnValue("plain-api-key");
    mockBuildDeps.mockReturnValue({ fetchFn: vi.fn() });
    mockCollectUnifi.mockResolvedValue({
      items: [{ observedKey: "unifi:aa:bb:cc:dd:ee:ff", itemType: "router" }],
      relationships: [],
      warnings: [],
    });
    mockNormalize.mockReturnValue({ entities: [], relationships: [] });
    mockPersistRun.mockResolvedValue({
      runId: "run-abc",
      createdEntities: 4,
      updatedEntities: 1,
      staleEntities: 0,
      createdRelationships: 2,
      updatedRelationships: 0,
      staleRelationships: 0,
      createdIssues: 0,
    });
    mockPrisma.discoveryConnection.update.mockResolvedValue({ ...baseConnection });

    const result = await rerunDiscoveryConnection("conn-1");

    expect(result).toEqual({
      ok: true,
      runId: "run-abc",
      itemCount: 5,
      relationshipCount: 2,
      status: "active",
    });
    expect(mockPersistRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ trigger: "manual_connection" }),
    );
  });
});
