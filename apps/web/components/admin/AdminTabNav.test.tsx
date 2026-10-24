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
    expect(html).toContain(">Organization &amp; settings<");
    expect(html).toContain(">Contributing &amp; GitHub<");
    expect(html).toContain(">Health &amp; recovery<");
    // EP-2FB6C0CC (BI-3ED24FA2): the "Advanced" holding tab is retired.
    expect(html).not.toContain(">Advanced<");
    expect(html).not.toContain(">Portal<");
    expect(html).not.toContain(">Reference Data<");
    expect(html).not.toContain(">Prompts<");
    // The admin secondary nav never links out to /platform (no cross-section jump).
    expect(html).not.toContain('href="/platform/ai"');
    expect(html).not.toContain(">AI Operations<");
  });

  it("shows only configuration sub-navigation for operating hours routes", () => {
    pathname = "/admin/operating-hours";
    const html = renderToStaticMarkup(<AdminTabNav />);

    expect(html).toContain(">Organization &amp; settings<");
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain('href="/admin/reference-data"');
    expect(html).toContain('href="/admin/business-models"');
    expect(html).not.toContain('href="/admin/operating-hours"');
    expect(html).not.toContain(">Operating Hours<");
    expect(html).not.toContain(">Your Business<");
    expect(html).not.toContain('href="/admin/prompts"');
  });

  it("keeps legacy prompt administration routes inside the contributing family", () => {
    pathname = "/admin/prompts";
    const html = renderToStaticMarkup(<AdminTabNav />);

    expect(html).toContain('href="/admin/platform-development"');
    expect(html).toContain('href="/admin/hive"');
    expect(html).not.toContain('href="/admin/issue-reports"');
    expect(html).not.toContain('href="/admin/prompts"');
    expect(html).not.toContain('href="/admin/skills"');
    expect(html).not.toContain(">Prompts<");
    expect(html).not.toContain(">Skills<");
    expect(html).not.toContain(">Settings<");
    expect(html).not.toContain(">Your Business<");
  });
});
