import { describe, expect, it, vi } from "vitest";

import { readOrganizationTopAccountablePrincipalId } from "./organization-accountable.server";

const db = (value: { topAccountablePrincipalId: string | null } | null) => ({
  organization: { findFirst: vi.fn(async () => value) },
});

describe("readOrganizationTopAccountablePrincipalId", () => {
  it("returns the recorded owner", async () => {
    await expect(readOrganizationTopAccountablePrincipalId(db({ topAccountablePrincipalId: "PRN-OWNER" })))
      .resolves.toBe("PRN-OWNER");
  });

  it("returns null when no owner is recorded, rather than guessing one", async () => {
    await expect(readOrganizationTopAccountablePrincipalId(db({ topAccountablePrincipalId: null })))
      .resolves.toBeNull();
  });

  it("treats a blank value as unset", async () => {
    await expect(readOrganizationTopAccountablePrincipalId(db({ topAccountablePrincipalId: "   " })))
      .resolves.toBeNull();
  });

  it("returns null when there is no organization at all", async () => {
    await expect(readOrganizationTopAccountablePrincipalId(db(null))).resolves.toBeNull();
  });

  it("scopes to one organization when an id is supplied", async () => {
    const client = db({ topAccountablePrincipalId: "PRN-A" });
    await readOrganizationTopAccountablePrincipalId(client, "org-1");
    expect(client.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-1" } }),
    );
  });

  it("does not filter by organization when none is supplied", async () => {
    const client = db({ topAccountablePrincipalId: "PRN-A" });
    await readOrganizationTopAccountablePrincipalId(client);
    expect(client.organization.findFirst).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    );
  });
});
