import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

import { loadMicrosoft365CommunicationsPreview } from "./preview";

describe("loadMicrosoft365CommunicationsPreview", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it("returns unavailable when no stored credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await loadMicrosoft365CommunicationsPreview();

    expect(result).toEqual({ state: "unavailable" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns available preview data and marks the credential connected", async () => {
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
    }
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("connected");
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
    expect(mockUpdate.mock.calls[0][0].data.status).toBe("error");
  });
});
