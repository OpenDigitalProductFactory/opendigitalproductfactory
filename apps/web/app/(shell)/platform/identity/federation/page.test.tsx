import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findMany: vi.fn(),
    },
    principalAlias: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityFederationPage", () => {
  it("shows Microsoft Entra and directory authority guidance", async () => {
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
    vi.mocked(prisma.principalAlias.count).mockResolvedValue(14 as never);

    const { default: PlatformIdentityFederationPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityFederationPage());

    expect(html).toContain("Federation");
    expect(html).toContain("Microsoft Entra");
    expect(html).toContain("LDAP / Active Directory");
    expect(html).toContain("Upstream authority");
    expect(html).toContain("Connected");
    expect(html).toContain("DPF remains the authorization source of truth");
  });
});
