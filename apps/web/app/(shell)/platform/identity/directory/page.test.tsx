import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// BI-DCE49BA9: the page renders the shared projection instead of computing a
// tree from a hardcoded base DN, so the fixture is now an Organization — the
// canonical source the DN derives from — plus the principals it publishes.
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    principal: { findMany: vi.fn() },
    principalAlias: { count: vi.fn() },
    platformRole: { findMany: vi.fn() },
    team: { findMany: vi.fn() },
    integrationCredential: { count: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityDirectoryPage", () => {
  it("derives the base DN from the organization and shows the published branches", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      slug: "acme",
      website: "https://www.acme.com",
    } as never);
    vi.mocked(prisma.principal.findMany).mockResolvedValue([
      { principalId: "prn-h", kind: "human", displayName: "Dana Reed", aliases: [] },
      { principalId: "prn-a", kind: "agent", displayName: "HR Specialist", aliases: [] },
    ] as never);
    vi.mocked(prisma.platformRole.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.team.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.principalAlias.count).mockResolvedValue(27);
    vi.mocked(prisma.integrationCredential.count).mockResolvedValue(2);
    vi.mocked(prisma.integrationCredential.findMany).mockResolvedValue([
      {
        id: "cred-entra-1",
        integrationId: "entra-primary",
        provider: "entra",
        status: "connected",
        fieldsEnc: "enc",
        tokenCacheEnc: null,
        lastTestedAt: new Date("2026-04-23T12:00:00Z"),
        lastErrorAt: null,
        lastErrorMsg: null,
        certExpiresAt: null,
        createdAt: new Date("2026-04-23T12:00:00Z"),
        updatedAt: new Date("2026-04-23T12:00:00Z"),
      },
    ] as never);

    const { default: PlatformIdentityDirectoryPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityDirectoryPage());

    expect(html).toContain("Directory");
    // Derived from Organization.website — NOT a constant in the route.
    expect(html).toContain("dc=acme,dc=com");
    expect(html).toContain("ou=people,dc=acme,dc=com");
    expect(html).toContain("ou=agents,dc=acme,dc=com");
    expect(html).toContain("ou=services,dc=acme,dc=com");
    expect(html).toContain("ou=groups,dc=acme,dc=com");
    expect(html).toContain("Read-only");
    expect(html).toContain("Microsoft Entra connected");
  });

  it("no longer carries the old hardcoded base DN", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      slug: "acme",
      website: null,
    } as never);
    vi.mocked(prisma.principal.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.platformRole.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.team.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.principalAlias.count).mockResolvedValue(0);
    vi.mocked(prisma.integrationCredential.count).mockResolvedValue(0);
    vi.mocked(prisma.integrationCredential.findMany).mockResolvedValue([] as never);

    const { default: PlatformIdentityDirectoryPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityDirectoryPage());

    expect(html).toContain("dc=acme,dc=internal");
    expect(html).not.toContain("dc=dpf,dc=internal");
  });
});
