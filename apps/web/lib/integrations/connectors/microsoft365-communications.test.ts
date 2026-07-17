import { describe, expect, it, vi } from "vitest";

import { ConnectorError } from "../kernel/error";
import {
  createMicrosoft365CommunicationsAdapter,
  microsoft365CommunicationsDefinition,
} from "./microsoft365-communications";

const input = {
  tenantId: "tenant-123",
  clientId: "client-123",
  clientSecret: "secret-123",
  mailboxUserPrincipalName: "alex@acme.com",
};

const token = {
  accessToken: "token-123",
  tokenType: "Bearer",
  expiresAt: new Date("2026-07-17T18:00:00.000Z"),
};

const probe = {
  tenant: { id: "tenant-123", displayName: "Acme" },
  mailbox: {
    id: "mailbox-123",
    displayName: "Alex",
    userPrincipalName: "alex@acme.com",
    mail: "alex@acme.com",
  },
  recentMessages: [],
  upcomingEvents: [],
  joinedTeams: [],
  firstTeamChannels: [],
  recentChannelMessages: [],
};

describe("Microsoft 365 Communications connector", () => {
  it("declares the client-credential communications contract", () => {
    expect(microsoft365CommunicationsDefinition).toMatchObject({
      schemaVersion: 1,
      key: "microsoft365-communications",
      auth: { kind: "oauth2-client-credentials" },
      callback: { kind: "none" },
      sync: { kind: "none" },
    });
    expect(microsoft365CommunicationsDefinition.capabilities).toEqual([
      "communications.email.read",
      "communications.calendar.read",
      "communications.teams.read",
    ]);
    expect(new Set(microsoft365CommunicationsDefinition.capabilities).size).toBe(
      microsoft365CommunicationsDefinition.capabilities.length,
    );
  });

  it("reuses validation, token exchange, and Graph probing and maps safe persistence", async () => {
    const exchange = vi.fn().mockResolvedValue(token);
    const graphProbe = vi.fn().mockResolvedValue(probe);
    const adapter = createMicrosoft365CommunicationsAdapter({ exchange, probe: graphProbe });

    const connected = await adapter.connect(input);

    expect(exchange).toHaveBeenCalledWith(input);
    expect(graphProbe).toHaveBeenCalledWith({
      mailboxUserPrincipalName: input.mailboxUserPrincipalName,
      accessToken: token.accessToken,
    });
    expect(connected.credential).toEqual({
      integrationId: "microsoft365-communications",
      provider: "microsoft365",
      reconnectFields: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        mailboxUserPrincipalName: input.mailboxUserPrincipalName,
      },
      secretFields: { clientSecret: input.clientSecret },
      tokenEnvelope: {
        accessToken: token.accessToken,
        tokenType: token.tokenType,
        expiresAt: token.expiresAt.toISOString(),
      },
      safeProjection: {
        tenantDisplayName: "Acme",
        mailboxDisplayName: "Alex",
        mailboxUserPrincipalName: "alex@acme.com",
        tokenExpiresAt: token.expiresAt.toISOString(),
      },
    });
  });

  it("maps auth and upstream failures to typed safe errors", async () => {
    const authAdapter = createMicrosoft365CommunicationsAdapter({
      exchange: vi.fn().mockRejectedValue(Object.assign(new Error("invalid Microsoft 365 credentials"), { name: "Microsoft365CommunicationsAuthError" })),
      probe: vi.fn(),
    });
    await expect(authAdapter.connect(input)).rejects.toMatchObject({
      kind: "authentication",
      message: "invalid Microsoft 365 credentials",
    } satisfies Partial<ConnectorError>);

    const probeAdapter = createMicrosoft365CommunicationsAdapter({
      exchange: vi.fn().mockResolvedValue(token),
      probe: vi.fn().mockRejectedValue(new Error("Graph communications read failed with status 503")),
    });
    await expect(probeAdapter.connect(input)).rejects.toMatchObject({
      kind: "upstream_unavailable",
      message: "Graph communications read failed with status 503",
    } satisfies Partial<ConnectorError>);
  });

  it("re-exchanges an expired client-credential token before probing", async () => {
    const exchange = vi.fn().mockResolvedValue(token);
    const graphProbe = vi.fn().mockResolvedValue(probe);
    const adapter = createMicrosoft365CommunicationsAdapter({ exchange, probe: graphProbe });

    await adapter.preview({
      ...input,
      cachedToken: {
        accessToken: "expired-token",
        tokenType: "Bearer",
        expiresAt: new Date("2026-07-17T17:59:59.000Z"),
      },
    }, new Date("2026-07-17T18:00:00.000Z"));

    expect(exchange).toHaveBeenCalledWith(expect.objectContaining(input));
    expect(graphProbe).toHaveBeenCalledWith({
      mailboxUserPrincipalName: input.mailboxUserPrincipalName,
      accessToken: "token-123",
    });
  });
});
