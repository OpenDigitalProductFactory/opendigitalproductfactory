import { afterEach, describe, expect, it, vi } from "vitest";

import {
  probeMicrosoft365Communications,
  resolveMicrosoftGraphBaseUrl,
} from "./communications-client";

describe("resolveMicrosoftGraphBaseUrl", () => {
  const original = process.env.MICROSOFT365_GRAPH_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.MICROSOFT365_GRAPH_BASE_URL;
    } else {
      process.env.MICROSOFT365_GRAPH_BASE_URL = original;
    }
  });

  it("defaults to the public Microsoft Graph API", () => {
    delete process.env.MICROSOFT365_GRAPH_BASE_URL;
    expect(resolveMicrosoftGraphBaseUrl()).toBe("https://graph.microsoft.com");
  });

  it("honors an explicit Graph base override for harness tests", () => {
    process.env.MICROSOFT365_GRAPH_BASE_URL = "http://integration-test-harness:8700";
    expect(resolveMicrosoftGraphBaseUrl()).toBe("http://integration-test-harness:8700");
  });
});

describe("probeMicrosoft365Communications", () => {
  const originalGraphBaseUrl = process.env.MICROSOFT365_GRAPH_BASE_URL;

  afterEach(async () => {
    if (originalGraphBaseUrl === undefined) {
      delete process.env.MICROSOFT365_GRAPH_BASE_URL;
    } else {
      process.env.MICROSOFT365_GRAPH_BASE_URL = originalGraphBaseUrl;
    }
  });

  it("returns mailbox, mail, calendar, teams, channels, and channel messages", async () => {
    delete process.env.MICROSOFT365_GRAPH_BASE_URL;
    const graphGet = vi
      .fn()
      .mockResolvedValueOnce({
        value: [{ id: "tenant-123", displayName: "Acme Managed Services" }],
      })
      .mockResolvedValueOnce({
        id: "user-123",
        displayName: "Alex Admin",
        userPrincipalName: "alex@acme.com",
        mail: "alex@acme.com",
      })
      .mockResolvedValueOnce({
        value: [
          {
            id: "message-1",
            subject: "Quarterly planning",
            receivedDateTime: "2026-04-24T08:00:00Z",
            isRead: false,
            from: { emailAddress: { name: "Megan Ops", address: "megan@acme.com" } },
          },
        ],
      })
      .mockResolvedValueOnce({
        value: [
          {
            id: "event-1",
            subject: "Inbox triage",
            start: { dateTime: "2026-04-24T09:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-04-24T09:30:00", timeZone: "UTC" },
            location: { displayName: "Teams Meeting" },
          },
        ],
      })
      .mockResolvedValueOnce({
        value: [{ id: "team-1", displayName: "Service Desk", description: "Primary delivery team" }],
      })
      .mockResolvedValueOnce({
        value: [{ id: "channel-1", displayName: "General", membershipType: "standard" }],
      })
      .mockResolvedValueOnce({
        value: [
          {
            id: "chat-1",
            createdDateTime: "2026-04-24T08:30:00Z",
            from: { user: { displayName: "Jordan Lead" } },
            body: { content: "<p>Hello team</p>" },
          },
        ],
      });

    const result = await probeMicrosoft365Communications({
      mailboxUserPrincipalName: "alex@acme.com",
      accessToken: "graph-token-123",
    }, {
      graphGet,
    });

    expect(result.tenant.displayName).toBe("Acme Managed Services");
    expect(result.mailbox.displayName).toBe("Alex Admin");
    expect(result.recentMessages[0]?.subject).toBe("Quarterly planning");
    expect(result.upcomingEvents[0]?.subject).toBe("Inbox triage");
    expect(result.joinedTeams[0]?.displayName).toBe("Service Desk");
    expect(result.firstTeamChannels[0]?.displayName).toBe("General");
    expect(result.recentChannelMessages[0]?.bodyPreview).toBe("Hello team");
  });

  it("throws when the mailbox summary is missing", async () => {
    const graphGet = vi
      .fn()
      .mockResolvedValueOnce({
        value: [{ id: "tenant-123", displayName: "Acme Managed Services" }],
      })
      .mockResolvedValueOnce({});

    await expect(
      probeMicrosoft365Communications({
        mailboxUserPrincipalName: "alex@acme.com",
        accessToken: "graph-token-123",
      }, {
        graphGet,
      }),
    ).rejects.toThrow("Graph communications probe returned no mailbox summary");
  });
});
