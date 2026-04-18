import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/admin";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

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

import { AdminTabNav } from "@/components/admin/AdminTabNav";

describe("AdminTabNav", () => {
  it("renders grouped admin families and removes the portal tab", () => {
    pathname = "/admin";
    const html = renderToStaticMarkup(<AdminTabNav />);

    expect(html).toContain('href="/admin"');
    expect(html).toContain(">Access<");
    expect(html).toContain(">Organization<");
    expect(html).toContain(">Configuration<");
    expect(html).toContain(">Advanced<");
    expect(html).not.toContain(">Portal<");
    expect(html).not.toContain(">Reference Data<");
    expect(html).not.toContain(">Prompts<");
  });

  it("shows only configuration sub-navigation for operating hours routes", () => {
    pathname = "/admin/operating-hours";
    const html = renderToStaticMarkup(<AdminTabNav />);

    expect(html).toContain(">Organization<");
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain('href="/admin/reference-data"');
    expect(html).toContain('href="/admin/business-models"');
    expect(html).not.toContain('href="/admin/operating-hours"');
    expect(html).not.toContain(">Operating Hours<");
    expect(html).not.toContain(">Your Business<");
    expect(html).not.toContain('href="/admin/prompts"');
  });

  it("shows only advanced sub-navigation for prompt administration routes", () => {
    pathname = "/admin/prompts";
    const html = renderToStaticMarkup(<AdminTabNav />);

    expect(html).toContain('href="/admin/platform-development"');
    expect(html).toContain('href="/admin/prompts"');
    expect(html).toContain('href="/admin/skills"');
    expect(html).toContain('href="/admin/issue-reports"');
    expect(html).toContain('href="/admin/diagnostics"');
    expect(html).not.toContain(">Settings<");
    expect(html).not.toContain(">Your Business<");
  });
});
