import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

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
    },
    employeeProfile: {
      count: vi.fn(),
    },
    agent: {
      count: vi.fn(),
    },
    userGroup: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("PlatformIdentityPage", () => {
  it("renders the identity workspace landing page with core management cards", async () => {
    vi.mocked(prisma.principal.count)
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    vi.mocked(prisma.principalAlias.count).mockResolvedValue(22);
    vi.mocked(prisma.integrationCredential.count).mockResolvedValue(1);
    vi.mocked(prisma.employeeProfile.count).mockResolvedValue(9);
    vi.mocked(prisma.agent.count).mockResolvedValue(5);
    vi.mocked(prisma.userGroup.count).mockResolvedValue(6);

    const { default: PlatformIdentityPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformIdentityPage());

    expect(html).toContain("Identity &amp; Access");
    expect(html).toContain("Principals");
    expect(html).toContain("Directory");
    expect(html).toContain("Federation");
    expect(html).toContain("Authorization");
    expect(html).toContain("Agent Identity");
  });
});
