import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockFindUnique, mockLoadPreview, mockAuth, mockCan } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLoadPreview: vi.fn(),
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptJson: vi.fn((value: string) => JSON.parse(value)),
}));

vi.mock("@/lib/integrate/microsoft365-communications/preview", () => ({
  loadMicrosoft365CommunicationsPreview: mockLoadPreview,
}));

vi.mock("@/components/integrations/Microsoft365CommunicationsConnectPanel", () => ({
  Microsoft365CommunicationsConnectPanel: ({
    initialState,
  }: {
    initialState: {
      status: string;
      tenantDisplayName: string | null;
      mailboxDisplayName: string | null;
      lastErrorMsg: string | null;
      lastTestedAt: string | null;
    };
  }) => (
    <div
      data-component="m365-connect-panel"
      data-status={initialState.status}
      data-tenant={initialState.tenantDisplayName ?? ""}
      data-mailbox={initialState.mailboxDisplayName ?? ""}
    />
  ),
}));

describe("Microsoft365CommunicationsPage", () => {
  it("renders live Microsoft 365 preview data and refreshes the connection state", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "superadmin", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockFindUnique.mockResolvedValue({
      integrationId: "microsoft365-communications",
      status: "connected",
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-04-24T05:00:00.000Z"),
      fieldsEnc: JSON.stringify({
        tenantDisplayName: "Old Tenant",
        mailboxDisplayName: "Old Mailbox",
        mailboxUserPrincipalName: "alex@acme.com",
      }),
    });
    mockLoadPreview.mockResolvedValue({
      state: "available",
      preview: {
        tenant: { id: "tenant-123", displayName: "Acme Managed Services" },
        mailbox: {
          id: "user-123",
          displayName: "Alex Admin",
          userPrincipalName: "alex@acme.com",
          mail: "alex@acme.com",
        },
        recentMessages: [
          {
            id: "message-1",
            subject: "Quarterly planning",
            receivedDateTime: "2026-04-24T08:00:00Z",
            isRead: false,
            from: { name: "Megan Ops", address: "megan@acme.com" },
          },
        ],
        upcomingEvents: [
          {
            id: "event-1",
            subject: "Inbox triage",
            start: { dateTime: "2026-04-24T09:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-04-24T09:30:00", timeZone: "UTC" },
            location: { displayName: "Teams Meeting" },
          },
        ],
        joinedTeams: [{ id: "team-1", displayName: "Service Desk", description: "Primary delivery team" }],
        firstTeamChannels: [{ id: "channel-1", displayName: "General", membershipType: "standard" }],
        recentChannelMessages: [
          {
            id: "chat-1",
            createdDateTime: "2026-04-24T08:30:00Z",
            from: { displayName: "Jordan Lead" },
            bodyPreview: "Hello team",
          },
        ],
        loadedAt: "2026-04-24T06:00:00.000Z",
      },
    });

    const { default: Microsoft365CommunicationsPage } = await import("./page");
    const html = renderToStaticMarkup(await Microsoft365CommunicationsPage());

    expect(mockLoadPreview).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-component="m365-connect-panel"');
    expect(html).toContain('data-tenant="Acme Managed Services"');
    expect(html).toContain('data-status="connected"');
    expect(html).toContain("Live communications preview");
    expect(html).toContain("Quarterly planning");
    expect(html).toContain("Inbox triage");
    expect(html).toContain("Service Desk");
    expect(html).toContain("General");
    expect(html).toContain("Hello team");
  });
});
