import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    principal: {
      count: vi.fn(),
    },
    principalAlias: {
      count: vi.fn(),
    },
    integrationCredential: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    platformRole: {
      count: vi.fn(),
    },
    team: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityDirectoryPage", () => {
  it("shows directory branches and publication posture from live identity counts", async () => {
    vi.mocked(prisma.principal.count)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.principalAlias.count).mockResolvedValue(27);
    vi.mocked(prisma.integrationCredential.count).mockResolvedValue(2);
    vi.mocked(prisma.platformRole.count).mockResolvedValue(4);
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
    ] as never);

    const { default: PlatformIdentityDirectoryPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityDirectoryPage());

    expect(html).toContain("Directory");
    expect(html).toContain("dc=dpf,dc=internal");
    expect(html).toContain("ou=people,dc=dpf,dc=internal");
    expect(html).toContain("ou=agents,dc=dpf,dc=internal");
    expect(html).toContain("ou=services,dc=dpf,dc=internal");
    expect(html).toContain("ou=groups,dc=dpf,dc=internal");
    expect(html).toContain("Read-only");
    expect(html).toContain("Microsoft Entra connected");
  });
});
