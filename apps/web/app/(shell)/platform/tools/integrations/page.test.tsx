import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockCount, mockOrgFindFirst, mockGetMatrixByOrg } = vi.hoisted(() => ({
  mockCount: vi.fn(),
  mockOrgFindFirst: vi.fn(),
  mockGetMatrixByOrg: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      count: mockCount,
    },
    organization: {
      findFirst: mockOrgFindFirst,
    },
  },
}));

vi.mock("@/lib/actions/integration-coverage", () => ({
  getMatrixByOrg: mockGetMatrixByOrg,
}));

beforeEach(() => {
  mockOrgFindFirst.mockResolvedValue({ id: "org-test" });
  mockGetMatrixByOrg.mockResolvedValue([]);
});

describe("EnterpriseIntegrationsPage", () => {
  it("surfaces the self-hosted WordPress channel without claiming hosting", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("WordPress (self-hosted)");
    expect(html).toContain("/platform/tools/integrations/wordpress");
    expect(html).toContain("Customer-owned website");
    expect(html).not.toContain("WordPress hosting included");
  });

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

  it("surfaces the employee communications fabric on the native integrations landing page", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("Employee Communications Fabric");
    expect(html).toContain("Employee Communications");
    expect(html).toContain("/platform/tools/integrations/communications");
  });

  it("surfaces Instagram Business on the native integrations landing page", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("Instagram Business");
    expect(html).toContain("Local Visual Presence");
    expect(html).toContain("/platform/tools/integrations/instagram-business");
  });

  it("renders the db-backed integration coverage matrix section", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("Integration Coverage Matrix");
    expect(html).toContain("No integration coverage rows configured");
  });

  it("keeps the employee-work integration coverage matrix out of the arrival DOM", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("Employee coverage");
    expect(html).not.toContain("Employee Work Coverage");
    expect(html).not.toContain("for_employees/financial_management");
  });

  it("defers the employee-work coverage matrix behind a collapsed disclosure", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain('data-testid="integration-coverage-disclosure"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="integration-coverage-disclosure-panel"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain('id="integration-coverage-disclosure-panel"');
  });
});
