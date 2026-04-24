import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    principalAlias: {
      count: vi.fn(),
    },
    userGroup: {
      count: vi.fn(),
    },
    team: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityApplicationsPage", () => {
  it("shows application federation readiness from current identity and authority state", async () => {
    vi.mocked(prisma.integrationCredential.count).mockResolvedValue(2);
    vi.mocked(prisma.principalAlias.count).mockResolvedValue(27);
    vi.mocked(prisma.userGroup.count).mockResolvedValue(6);
    vi.mocked(prisma.team.count).mockResolvedValue(4);
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
      {
        id: "cred-ldap-1",
        integrationId: "ldap-primary",
        provider: "ldap",
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

    const { default: PlatformIdentityApplicationsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityApplicationsPage());

    expect(html).toContain("Applications");
    expect(html).toContain("OIDC");
    expect(html).toContain("SAML");
    expect(html).toContain("LDAP-only");
    expect(html).toContain("Manual today, SCIM-ready next");
    expect(html).toContain("connected");
  });
});
