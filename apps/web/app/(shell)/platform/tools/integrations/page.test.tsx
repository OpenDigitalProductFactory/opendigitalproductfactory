import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockCount } = vi.hoisted(() => ({
  mockCount: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      count: mockCount,
    },
  },
}));

describe("EnterpriseIntegrationsPage", () => {
  it("surfaces the Facebook Pages card on the native integrations landing page", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("Native Integrations");
    expect(html).toContain("Facebook Pages");
    expect(html).toContain("/platform/tools/integrations/facebook-pages");
  });

  it("surfaces WhatsApp Business on the native integrations landing page", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("WhatsApp Business");
    expect(html).toContain("Localized Messaging");
    expect(html).toContain("/platform/tools/integrations/whatsapp-business");
  });

  it("surfaces Instagram Business on the native integrations landing page", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("Instagram Business");
    expect(html).toContain("Local Visual Presence");
    expect(html).toContain("/platform/tools/integrations/instagram-business");
  });
});
