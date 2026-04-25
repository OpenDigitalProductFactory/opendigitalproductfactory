import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: { integrationCredential: { upsert: mockUpsert } },
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
    const result = await connectMicrosoft365Communications(baseInput(), {
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

    expect(result.ok).toBe(true);
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
    const result = await connectMicrosoft365Communications(
      { ...baseInput(), clientSecret: "super-secret-do-not-leak" },
      {
        exchangeMicrosoftGraphClientCredentials: vi
          .fn()
          .mockRejectedValue(new Error("invalid Microsoft 365 credentials")),
      },
    );

    expect(result).toMatchObject({ ok: false, status: "error", statusCode: 400 });
    if (!result.ok) {
      expect(result.error).not.toContain("super-secret-do-not-leak");
    }

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.status).toBe("error");
    expect(call.create.lastErrorMsg).not.toContain("super-secret-do-not-leak");
  });
});
