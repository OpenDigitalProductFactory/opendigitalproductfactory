import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    principal: {
      findMany: vi.fn(),
    },
    principalAlias: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityPrincipalsPage", () => {
  it("shows humans and agents on the principals page", async () => {
    vi.mocked(prisma.principal.findMany).mockResolvedValue([
      {
        id: "principal-1",
        principalId: "PRN-000001",
        kind: "human",
        status: "active",
        displayName: "Ada Lovelace",
        createdAt: new Date("2026-04-23T00:00:00Z"),
        updatedAt: new Date("2026-04-23T00:00:00Z"),
      },
      {
        id: "principal-2",
        principalId: "PRN-000002",
        kind: "agent",
        status: "active",
        displayName: "Finance Specialist",
        createdAt: new Date("2026-04-23T00:00:00Z"),
        updatedAt: new Date("2026-04-23T00:00:00Z"),
      },
    ] as never);
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
      {
        id: "alias-1",
        principalId: "principal-1",
        aliasType: "employee",
        aliasValue: "EMP-001",
        issuer: "",
        createdAt: new Date("2026-04-23T00:00:00Z"),
      },
      {
        id: "alias-2",
        principalId: "principal-2",
        aliasType: "agent",
        aliasValue: "AGT-100",
        issuer: "",
        createdAt: new Date("2026-04-23T00:00:00Z"),
      },
    ] as never);

    const { default: PlatformIdentityPrincipalsPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityPrincipalsPage());

    expect(html).toContain("Principals");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Finance Specialist");
    expect(html).toContain("human");
    expect(html).toContain("agent");
  });
});
