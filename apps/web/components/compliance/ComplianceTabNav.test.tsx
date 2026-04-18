import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/compliance";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { ComplianceTabNav } from "@/components/compliance/ComplianceTabNav";

describe("ComplianceTabNav", () => {
  it("renders grouped top-level tabs instead of the old flat strip", () => {
    pathname = "/compliance";
    const html = renderToStaticMarkup(<ComplianceTabNav />);

    expect(html).toContain(">Overview<");
    expect(html).toContain(">Library<");
    expect(html).toContain(">Controls<");
    expect(html).toContain(">Assurance<");
    expect(html).toContain(">Risk<");
    expect(html).toContain(">Operations<");
    expect(html).not.toContain(">Dashboard<");
    expect(html).not.toContain(">Policies<");
  });

  it("shows only the active family's sub-navigation", () => {
    pathname = "/compliance/risks";
    const html = renderToStaticMarkup(<ComplianceTabNav />);

    expect(html).toContain('href="/compliance/risks"');
    expect(html).toContain('href="/compliance/incidents"');
    expect(html).toContain('href="/compliance/actions"');
    expect(html).toContain('href="/compliance/gaps"');
    expect(html).not.toContain(">Policies<");
    expect(html).not.toContain(">Regulations<");
  });
});
