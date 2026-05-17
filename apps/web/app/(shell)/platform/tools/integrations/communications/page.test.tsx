import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCommunicationChannelBindings: vi.fn(),
}));

vi.mock("@/lib/communications/channel-binding-store", () => ({
  listCommunicationChannelBindings: mocks.listCommunicationChannelBindings,
}));

// Slice 1 / Task 11: stub the STT card so its prisma-touching server logic
// doesn't run during this page-level test (the card has its own unit tests).
// Return a sync element rather than an async server component — the test's
// `renderToStaticMarkup` cannot suspend on async children.
vi.mock("@/components/admin/SpeechToTextCard", () => ({
  SpeechToTextCard: () => "[SpeechToTextCard]",
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCommunicationChannelBindings.mockResolvedValue({
    summary: {
      total: 2,
      active: 2,
      verified: 1,
      failed: 0,
      pending: 1,
    },
    bindings: [
      {
        bindingId: "bind-1",
        channelType: "teams",
        providerKey: "microsoft365",
        providerAccountId: "tenant-1",
        externalSubject: "user@contoso.com",
        displayLabel: "Microsoft Teams",
        verificationStatus: "verified",
        allowedUrgencies: ["priority", "urgent"],
        isActive: true,
        lastTestedAt: "2026-05-15T10:00:00.000Z",
        lastVerifiedAt: "2026-05-15T10:00:00.000Z",
        lastError: null,
        principalDisplayName: "Alex Chen",
        employeeDisplayName: "Alex C.",
      },
      {
        bindingId: "bind-2",
        channelType: "whatsapp",
        providerKey: "meta_whatsapp",
        providerAccountId: "",
        externalSubject: "+15551212",
        displayLabel: "Field WhatsApp",
        verificationStatus: "pending",
        allowedUrgencies: ["urgent"],
        isActive: true,
        lastTestedAt: null,
        lastVerifiedAt: null,
        lastError: "Template not approved",
        principalDisplayName: "Riley Stone",
        employeeDisplayName: null,
      },
    ],
  });
});

describe("CommunicationsPage", () => {
  it("renders provider readiness groups for the communication fabric", async () => {
    const { default: CommunicationsPage } = await import("./page");
    const html = renderToStaticMarkup(await CommunicationsPage());

    expect(html).toContain("Communications");
    expect(html).toContain("DPF-owned baseline");
    expect(html).toContain("Enterprise real-time");
    expect(html).toContain("Field and local messaging");
    expect(html).toContain("Telegram");
    expect(html).toContain("WhatsApp Business");
  });

  it("renders channel binding summary and recent bindings", async () => {
    const { default: CommunicationsPage } = await import("./page");
    const html = renderToStaticMarkup(await CommunicationsPage());

    expect(html).toContain("Channel bindings");
    expect(html).toContain("2 active");
    expect(html).toContain("1 verified");
    expect(html).toContain("1 pending");
    expect(html).toContain("Microsoft Teams");
    expect(html).toContain("Alex Chen");
    expect(html).toContain("Field WhatsApp");
    expect(html).toContain("Template not approved");
  });
});
