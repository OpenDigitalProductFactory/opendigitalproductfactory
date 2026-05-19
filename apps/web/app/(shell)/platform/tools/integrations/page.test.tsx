import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { mockCount, mockGetMatrixByOrg } = vi.hoisted(() => ({
  mockCount: vi.fn(),
  mockGetMatrixByOrg: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      count: mockCount,
    },
  },
}));

vi.mock("@/lib/actions/integration-coverage", () => ({
  getMatrixByOrg: mockGetMatrixByOrg,
}));

describe("EnterpriseIntegrationsPage", () => {
  it("renders the integration coverage matrix section", async () => {
    mockCount.mockResolvedValue(0);
    mockGetMatrixByOrg.mockResolvedValue([]);

    const { default: EnterpriseIntegrationsPage } = await import("./page");
    const html = renderToStaticMarkup(await EnterpriseIntegrationsPage());

    expect(html).toContain("Integration Coverage Matrix");
  });
});
