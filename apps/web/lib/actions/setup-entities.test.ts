import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organizationFindFirst: vi.fn(),
  organizationFindUnique: vi.fn(),
  organizationCreate: vi.fn(),
  organizationUpdate: vi.fn(),
  linkSetupToOrg: vi.fn(),
  linkSetupToUser: vi.fn(),
  organizationUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  setupProgressFindUnique: vi.fn(),
  syncUserPrincipal: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findFirst: mocks.organizationFindFirst,
      findUnique: mocks.organizationFindUnique,
      create: mocks.organizationCreate,
      update: mocks.organizationUpdate,
      updateMany: mocks.organizationUpdateMany,
    },
    user: {
      findUnique: mocks.userFindUnique,
      create: mocks.userCreate,
    },
    platformSetupProgress: {
      findUnique: mocks.setupProgressFindUnique,
    },
  },
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  syncUserPrincipal: mocks.syncUserPrincipal,
}));

vi.mock("./setup-progress", () => ({
  linkSetupToOrg: mocks.linkSetupToOrg,
  linkSetupToUser: mocks.linkSetupToUser,
}));

vi.mock("../password", () => ({
  hashPassword: vi.fn(),
}));

import { createOrganization, createOwnerAccount } from "./setup-entities";

describe("createOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the bootstrap organization instead of creating a second org", async () => {
    mocks.organizationFindFirst.mockResolvedValue({
      id: "org-bootstrap",
      orgId: "ORG-PLATFORM",
      slug: "platform",
    });
    mocks.organizationFindUnique.mockResolvedValue(null);
    mocks.organizationUpdate.mockResolvedValue({
      id: "org-bootstrap",
      orgId: "ORG-1776475234030",
      name: "Acme Health",
      slug: "acme-health",
    });

    const result = await createOrganization("setup-1", {
      orgName: "Acme Health",
      industry: "Healthcare",
      location: "Chicago, IL",
      timezone: "America/Chicago",
    });

    expect(mocks.organizationCreate).not.toHaveBeenCalled();
    expect(mocks.organizationUpdate).toHaveBeenCalledWith({
      where: { id: "org-bootstrap" },
      data: expect.objectContaining({
        name: "Acme Health",
        slug: "acme-health",
        industry: "Healthcare",
        address: { location: "Chicago, IL", timezone: "America/Chicago" },
      }),
    });

    const updateArgs = mocks.organizationUpdate.mock.calls[0][0];
    expect(updateArgs.data.orgId).toMatch(/^ORG-/);
    expect(updateArgs.data.orgId).not.toBe("ORG-PLATFORM");
    expect(mocks.linkSetupToOrg).toHaveBeenCalledWith("setup-1", "org-bootstrap");
    expect(result.id).toBe("org-bootstrap");
  });

  it("creates a new organization when none exists yet", async () => {
    mocks.organizationFindFirst.mockResolvedValue(null);
    mocks.organizationFindUnique.mockResolvedValue(null);
    mocks.organizationCreate.mockResolvedValue({
      id: "org-new",
      orgId: "ORG-1776475234031",
      name: "Acme Health",
      slug: "acme-health",
    });

    const result = await createOrganization("setup-2", {
      orgName: "Acme Health",
    });

    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
    expect(mocks.organizationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Acme Health",
        slug: "acme-health",
      }),
    });
    expect(mocks.linkSetupToOrg).toHaveBeenCalledWith("setup-2", "org-new");
    expect(result.id).toBe("org-new");
  });
});

describe("createOwnerAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({ id: "user-owner", email: "owner@example.test" });
    mocks.syncUserPrincipal.mockResolvedValue({
      id: "principal-owner",
      principalId: "PRN-owner",
      kind: "human",
      status: "active",
    });
    mocks.setupProgressFindUnique.mockResolvedValue({ organizationId: "org-setup" });
    mocks.organizationUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("records the new owner as the organization's accountable owner when none is set", async () => {
    await expect(
      createOwnerAccount("setup-1", { name: "Org", email: "owner@example.test", password: "password1" }),
    ).resolves.toEqual({ userId: "user-owner", email: "owner@example.test" });

    expect(mocks.syncUserPrincipal).toHaveBeenCalledWith("user-owner");
    expect(mocks.setupProgressFindUnique).toHaveBeenCalledWith({
      where: { id: "setup-1" },
      select: { organizationId: true },
    });
    // The null guard lives in the WHERE clause, so an existing choice is never overwritten.
    expect(mocks.organizationUpdateMany).toHaveBeenCalledWith({
      where: { id: "org-setup", topAccountablePrincipalId: null },
      data: { topAccountablePrincipalId: "principal-owner" },
    });
  });

  it("leaves an existing accountable owner untouched", async () => {
    mocks.organizationUpdateMany.mockResolvedValue({ count: 0 });
    await createOwnerAccount("setup-1", { name: "Org", email: "owner@example.test", password: "password1" });
    expect(mocks.organizationUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.organizationUpdate).not.toHaveBeenCalled();
    expect(mocks.organizationUpdateMany.mock.calls[0][0].where).toEqual({
      id: "org-setup",
      topAccountablePrincipalId: null,
    });
  });

  it("applies the same unset-only rule when setup is re-run for an existing user", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-existing", email: "owner@example.test" });
    await createOwnerAccount("setup-1", { name: "Org", email: "owner@example.test", password: "password1" });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.syncUserPrincipal).toHaveBeenCalledWith("user-existing");
    expect(mocks.organizationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "org-setup", topAccountablePrincipalId: null },
    }));
  });

  it("still completes account creation when the principal cannot be linked", async () => {
    mocks.syncUserPrincipal.mockRejectedValue(new Error("alias conflict"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      createOwnerAccount("setup-1", { name: "Org", email: "owner@example.test", password: "password1" }),
    ).resolves.toEqual({ userId: "user-owner", email: "owner@example.test" });
    expect(mocks.organizationUpdateMany).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
