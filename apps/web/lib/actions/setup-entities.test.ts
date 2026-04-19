import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organizationFindFirst: vi.fn(),
  organizationFindUnique: vi.fn(),
  organizationCreate: vi.fn(),
  organizationUpdate: vi.fn(),
  linkSetupToOrg: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findFirst: mocks.organizationFindFirst,
      findUnique: mocks.organizationFindUnique,
      create: mocks.organizationCreate,
      update: mocks.organizationUpdate,
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("./setup-progress", () => ({
  linkSetupToOrg: mocks.linkSetupToOrg,
  linkSetupToUser: vi.fn(),
}));

vi.mock("../password", () => ({
  hashPassword: vi.fn(),
}));

import { createOrganization } from "./setup-entities";

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
