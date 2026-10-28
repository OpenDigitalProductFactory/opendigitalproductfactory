import { describe, expect, it, vi } from "vitest";

import { resolveReaderOrganizationId } from "./reader-organization";

function db(ids: string[]) {
  return { organization: { findMany: vi.fn(async () => ids.map((id) => ({ id }))) } };
}

describe("resolveReaderOrganizationId (R2 seam, BI-4EAFF7AC)", () => {
  it("returns the organization when the install holds exactly one", async () => {
    await expect(resolveReaderOrganizationId(db(["org-a"]))).resolves.toBe("org-a");
  });

  it("fails closed with two organizations: an MSP install must not pick one customer for everyone", async () => {
    await expect(resolveReaderOrganizationId(db(["org-a", "org-b"]))).resolves.toBeNull();
  });

  it("returns null on an install with no organization", async () => {
    await expect(resolveReaderOrganizationId(db([]))).resolves.toBeNull();
  });

  it("reads at most two rows, enough to tell one from many", async () => {
    const client = db(["org-a"]);
    await resolveReaderOrganizationId(client);
    expect(client.organization.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
  });
});
