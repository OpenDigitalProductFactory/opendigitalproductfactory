import { describe, expect, it } from "vitest";
import { resolveSingleInstallOrganizationId } from "./single-organization";

const db = (ids: string[]) => ({
  organization: { findMany: async ({ take }: { take: number }) => ids.slice(0, take).map((id) => ({ id })) },
});

describe("resolveSingleInstallOrganizationId (BI-3895E6F5)", () => {
  it("answers the organization only when the install holds exactly one", async () => {
    await expect(resolveSingleInstallOrganizationId(db(["org-1"]))).resolves.toBe("org-1");
  });

  it("fails closed with no organization or with several", async () => {
    await expect(resolveSingleInstallOrganizationId(db([]))).resolves.toBeNull();
    await expect(resolveSingleInstallOrganizationId(db(["org-1", "org-2"]))).resolves.toBeNull();
    await expect(resolveSingleInstallOrganizationId(db(["org-1", "org-2", "org-3"]))).resolves.toBeNull();
  });
});
