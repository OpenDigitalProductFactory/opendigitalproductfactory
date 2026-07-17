import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockFindUnique, mockUpdate, mockAuditCreate, mockTransaction } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      update: mockUpdate,
    },
    $transaction: mockTransaction,
  },
}));

import { connectMicrosoft365Communications } from "./connect-action";

function baseInput() {
  return {
    tenantId: "tenant-123",
    clientId: "client-id",
    clientSecret: "client-secret",
    mailboxUserPrincipalName: "alex@acme.com",
  };
}

describe("connectMicrosoft365Communications", () => {
  const originalGraphBaseUrl = process.env.MICROSOFT365_GRAPH_BASE_URL;
  const originalTokenEndpoint = process.env.MICROSOFT365_TOKEN_ENDPOINT_URL;

  beforeEach(() => {
    delete process.env.MICROSOFT365_GRAPH_BASE_URL;
    delete process.env.MICROSOFT365_TOKEN_ENDPOINT_URL;
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue(null);
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    mockAuditCreate.mockReset();
    mockAuditCreate.mockResolvedValue({});
    mockTransaction.mockReset();
    mockTransaction.mockImplementation((operation) => operation({
      integrationCredential: {
        findUnique: mockFindUnique,
        upsert: mockUpsert,
        update: mockUpdate,
      },
      integrationToolCallLog: { create: mockAuditCreate },
    }));
  });

  afterEach(async () => {
    if (originalGraphBaseUrl === undefined) {
      delete process.env.MICROSOFT365_GRAPH_BASE_URL;
    } else {
      process.env.MICROSOFT365_GRAPH_BASE_URL = originalGraphBaseUrl;
    }
    if (originalTokenEndpoint === undefined) {
      delete process.env.MICROSOFT365_TOKEN_ENDPOINT_URL;
    } else {
      process.env.MICROSOFT365_TOKEN_ENDPOINT_URL = originalTokenEndpoint;
    }
  });

  it("returns ok:true and persists a connected Microsoft 365 communications credential row", async () => {
    const testedAt = new Date("2026-07-17T18:30:00.000Z");
    const result = await connectMicrosoft365Communications(baseInput(), {
      now: () => testedAt,
      exchangeMicrosoftGraphClientCredentials: vi.fn().mockResolvedValue({
        accessToken: "graph-token-123",
        tokenType: "Bearer",
        expiresAt: new Date("2026-04-24T10:00:00.000Z"),
      }),
      probeMicrosoft365Communications: vi.fn().mockResolvedValue({
        tenant: { id: "tenant-123", displayName: "Acme Managed Services" },
        mailbox: {
          id: "user-123",
          displayName: "Alex Admin",
          userPrincipalName: "alex@acme.com",
          mail: "alex@acme.com",
        },
        recentMessages: [],
        upcomingEvents: [],
        joinedTeams: [],
        firstTeamChannels: [],
        recentChannelMessages: [],
      }),
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result).toMatchObject({
      status: "connected",
      tenantDisplayName: "Acme Managed Services",
      mailboxDisplayName: "Alex Admin",
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.integrationId).toBe("microsoft365-communications");
    expect(call.create.provider).toBe("microsoft365");
    expect(call.create.status).toBe("connected");
    expect(call.create.fieldsEnc).toBeTypeOf("string");
    expect(call.create.tokenCacheEnc).toBeTypeOf("string");
    expect(call.create.lastTestedAt).toEqual(testedAt);
    expect(call.create.lastErrorAt).toBeNull();
    expect(call.create.lastErrorMsg).toBeNull();
    expect(result).toMatchObject({ lastTestedAt: testedAt.toISOString() });
    expect(mockAuditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      integration: "microsoft365-communications",
      toolName: "connect",
      responseKind: "connected",
    }) });
  });

  it("returns 400 and does not persist on invalid input", async () => {
    const result = await connectMicrosoft365Communications(
      { ...baseInput(), mailboxUserPrincipalName: "" },
      {},
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("persists status=error with a redacted message on invalid credentials", async () => {
    const failedAt = new Date("2026-07-17T19:15:00.000Z");
    const result = await connectMicrosoft365Communications(
      { ...baseInput(), clientSecret: "super-secret-do-not-leak" },
      {
        exchangeMicrosoftGraphClientCredentials: vi
          .fn()
          .mockRejectedValue(new Error("provider leaked super-secret-do-not-leak")),
        now: () => failedAt,
      },
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    if (!result.ok) {
      expect(result.error).not.toContain("super-secret-do-not-leak");
      expect(result.error).toBe("Connector provider is unavailable.");
    }

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe("error");
    expect(call.create.lastTestedAt).toBeNull();
    expect(call.create.lastErrorAt).toEqual(failedAt);
    expect(call.create.lastErrorMsg).toBe("Connector provider is unavailable.");
    expect(call.create.lastErrorMsg).not.toContain("super-secret-do-not-leak");
    expect(JSON.parse(call.create.fieldsEnc)).toMatchObject({
      reconnectFields: {
        tenantId: "tenant-123",
        clientId: "client-id",
        mailboxUserPrincipalName: "alex@acme.com",
      },
      secretFields: {},
    });
    expect(call.create.tokenCacheEnc).toBeNull();
    expect(mockAuditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      responseKind: "error",
      errorCode: "upstream_unavailable",
    }) });
  });

  it("preserves a working credential when replacement authentication fails", async () => {
    const previousTestedAt = new Date("2026-07-16T10:00:00.000Z");
    const failedAt = new Date("2026-07-17T19:15:00.000Z");
    mockFindUnique.mockResolvedValue({ status: "connected", lastTestedAt: previousTestedAt });

    await connectMicrosoft365Communications(baseInput(), {
      exchangeMicrosoftGraphClientCredentials: vi.fn().mockRejectedValue(
        new Error("invalid Microsoft 365 credentials"),
      ),
      now: () => failedAt,
    });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { integrationId: "microsoft365-communications" },
      data: expect.objectContaining({ lastErrorAt: expect.any(Date) }),
    });
    expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty("status");
    expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty("lastTestedAt");
    expect(mockUpdate.mock.calls[0][0].data.lastErrorAt).toEqual(failedAt);
    expect(mockUpdate.mock.calls[0][0].data.lastErrorMsg).toBe("Connector provider is unavailable.");
  });
});
