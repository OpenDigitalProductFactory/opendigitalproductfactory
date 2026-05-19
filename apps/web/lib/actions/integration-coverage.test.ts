import { describe, expect, it, vi } from "vitest";

const roles = [
  "owner_operator",
  "bookkeeper_accountant",
  "sales_bd",
  "marketer",
  "service_ops",
  "customer_support",
  "hr_payroll_admin",
  "it_security_compliance",
  "inventory_procurement_admin",
] as const;

const coverageRows = ["org-a", "org-b"].flatMap((organizationId) =>
  roles.map((role) => ({
    id: `${organizationId}-${role}`,
    organizationId,
    providerKey: "quickbooks",
    role,
    surface: "core",
    readPosture: "observe",
    writeGates: [] as string[],
    createdAt: new Date(),
  })),
);

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationRoleCoverage: {
      findMany: vi.fn((args?: { where?: { organizationId?: string } }) => {
        const organizationId = args?.where?.organizationId;
        return Promise.resolve(
          organizationId
            ? coverageRows.filter((row) => row.organizationId === organizationId)
            : coverageRows,
        );
      }),
    },
  },
}));

import { prisma } from "@dpf/db";
import { getMatrixByOrg } from "./integration-coverage";

describe("getMatrixByOrg", () => {
  it("returns only org-a integration coverage rows", async () => {
    const matrix = await getMatrixByOrg("org-a");

    expect(matrix).toHaveLength(roles.length);
    expect(matrix.every((row) => row.organizationId === "org-a")).toBe(true);
    expect(matrix.some((row) => row.organizationId === "org-b")).toBe(false);
    expect(matrix.map((row) => row.role).sort()).toEqual([...roles].sort());
    expect(prisma.integrationRoleCoverage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-a" }),
      }),
    );
  });

  it("returns only org-b integration coverage rows", async () => {
    const matrix = await getMatrixByOrg("org-b");

    expect(matrix).toHaveLength(roles.length);
    expect(matrix.every((row) => row.organizationId === "org-b")).toBe(true);
    expect(matrix.some((row) => row.organizationId === "org-a")).toBe(false);
    expect(matrix.map((row) => row.role).sort()).toEqual([...roles].sort());
    expect(prisma.integrationRoleCoverage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-b" }),
      }),
    );
  });
});
