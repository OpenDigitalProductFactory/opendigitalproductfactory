import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockUpsert, mockAuditCreate, mockTransaction } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      upsert: mockUpsert,
    },
    $transaction: mockTransaction,
  },
}));

import { loadMicrosoft365CommunicationsPreview } from "./preview";

describe("loadMicrosoft365CommunicationsPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockAuditCreate.mockReset();
    mockAuditCreate.mockResolvedValue({});
    mockTransaction.mockReset();
    mockTransaction.mockImplementation((operation) => operation({
      integrationCredential: {
        findUnique: mockFindUnique,
        update: mockUpdate,
        upsert: mockUpsert,
      },
      integrationToolCallLog: { create: mockAuditCreate },
    }));
  });

  it("returns unavailable when no stored credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await loadMicrosoft365CommunicationsPreview();

    expect(result).toEqual({ state: "unavailable" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns available preview data and marks the credential connected", async () => {
    const testedAt = new Date("2026-07-17T18:30:00.000Z");
    mockFindUnique.mockResolvedValue({
      integrationId: "microsoft365-communications",
      fieldsEnc: JSON.stringify({
        tenantId: "tenant-123",
        clientId: "client-id",
        clientSecret: "client-secret",
        mailboxUserPrincipalName: "alex@acme.com",
      }),
    });

    const result = await loadMicrosoft365CommunicationsPreview({
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

    expect(result.state).toBe("available");
    if (result.state === "available") {
      expect(result.preview.tenant.displayName).toBe("Acme Managed Services");
      expect(result.preview.mailbox.displayName).toBe("Alex Admin");
      expect(result.preview.loadedAt).toBe(testedAt.toISOString());
    }
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].update).toMatchObject({
      status: "connected",
      lastTestedAt: testedAt,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
    expect(mockAuditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      toolName: "health",
      responseKind: "connected",
    }) });
  });

  it("returns error and marks the credential errored when the probe fails", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "microsoft365-communications",
      fieldsEnc: JSON.stringify({
        tenantId: "tenant-123",
        clientId: "client-id",
        clientSecret: "client-secret",
        mailboxUserPrincipalName: "alex@acme.com",
      }),
      status: "connected",
    });

    const result = await loadMicrosoft365CommunicationsPreview({
      exchangeMicrosoftGraphClientCredentials: vi.fn().mockResolvedValue({
        accessToken: "graph-token-123",
        tokenType: "Bearer",
        expiresAt: new Date("2026-04-24T10:00:00.000Z"),
      }),
      probeMicrosoft365Communications: vi
        .fn()
        .mockRejectedValue(new Error("Graph communications probe failed")),
    });

    expect(result).toEqual({
      state: "error",
      error: "Graph communications probe failed",
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      where: { integrationId: "microsoft365-communications" },
      data: expect.objectContaining({
        lastErrorAt: expect.any(Date),
        lastErrorMsg: "Graph communications probe failed",
      }),
    });
    expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty("status");
    expect(mockAuditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      responseKind: "degraded",
      errorCode: "upstream_unavailable",
    }) });
  });

  it("uses an unexpired cached client-credential token without re-exchange", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "microsoft365-communications",
      status: "connected",
      fieldsEnc: JSON.stringify({
        schemaVersion: 1,
        reconnectFields: {
          tenantId: "tenant-123",
          clientId: "client-id",
          mailboxUserPrincipalName: "alex@acme.com",
        },
        secretFields: { clientSecret: "client-secret" },
        safeProjection: {},
      }),
      tokenCacheEnc: JSON.stringify({
        schemaVersion: 1,
        tokenEnvelope: {
          accessToken: "cached-token",
          tokenType: "Bearer",
          expiresAt: "2026-07-17T20:00:00.000Z",
        },
      }),
    });
    const exchange = vi.fn();
    const probe = vi.fn().mockResolvedValue({
      tenant: { id: "tenant-123", displayName: "Acme" },
      mailbox: { id: "user-1", displayName: "Alex", userPrincipalName: "alex@acme.com", mail: "alex@acme.com" },
      recentMessages: [], upcomingEvents: [], joinedTeams: [], firstTeamChannels: [], recentChannelMessages: [],
    });

    await loadMicrosoft365CommunicationsPreview({
      exchangeMicrosoftGraphClientCredentials: exchange,
      probeMicrosoft365Communications: probe,
      now: () => new Date("2026-07-17T19:00:00.000Z"),
    });

    expect(exchange).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledWith({
      mailboxUserPrincipalName: "alex@acme.com",
      accessToken: "cached-token",
    });
  });
});
