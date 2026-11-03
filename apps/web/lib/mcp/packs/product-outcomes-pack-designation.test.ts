// BI-42399593: the organization designates which business Product platform
// work serves; the platform then records delivered-work outcomes against it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  designate: vi.fn(),
  organization: vi.fn(async () => ({ id: "org-1" })),
}));

vi.mock("@dpf/db", () => ({ prisma: { organization: { findFirst: mocks.organization } } }));
vi.mock("@/lib/product-management/delivered-work-outcomes-repository", () => ({
  designatePlatformWorkProduct: mocks.designate,
}));
vi.mock("@/lib/product-management/product-management-playbook-refresh", () => ({
  queueProductManagementPlaybookRefreshForObjective: vi.fn(async () => undefined),
}));

import { productOutcomesPack } from "./product-outcomes-pack";

const definition = () => productOutcomesPack.definitions.find((tool) => tool.name === "designate_platform_work_product");

describe("designate_platform_work_product", () => {
  beforeEach(() => mocks.designate.mockReset());

  it("is a governed write that names the business decision it carries out", () => {
    expect(definition()).toMatchObject({
      requiredCapability: "manage_backlog",
      sideEffect: true,
      consequence: "authority",
      inputSchema: { required: ["productId", "decisionRef"] },
    });
    expect(productOutcomesPack.grants?.["designate_platform_work_product"]).toEqual(["backlog_write"]);
  });

  it("designates the Product in the caller's organization and reports the standing objective", async () => {
    mocks.designate.mockResolvedValue({ created: true, objectiveId: "OBJ-STANDING" });

    const result = await productOutcomesPack.handlers["designate_platform_work_product"]!(
      { productId: "product-1", decisionRef: "DI-74F9A2197C78" }, {} as never,
    );

    expect(mocks.designate).toHaveBeenCalledWith(expect.anything(), { organizationId: "org-1", productId: "product-1" });
    expect(result).toMatchObject({ success: true, entityId: "OBJ-STANDING" });
  });

  it("refuses without the decision that authorizes the designation", async () => {
    const result = await productOutcomesPack.handlers["designate_platform_work_product"]!(
      { productId: "product-1" }, {} as never,
    );

    expect(result).toMatchObject({ success: false });
    expect(mocks.designate).not.toHaveBeenCalled();
  });
});
