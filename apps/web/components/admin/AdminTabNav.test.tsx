import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/branding",
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { AdminTabNav } from "@/components/admin/AdminTabNav";

describe("AdminTabNav", () => {
  it("renders Access, Branding, and Settings tabs", () => {
    const html = renderToStaticMarkup(<AdminTabNav />);

    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/branding"');
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain(">Access<");
    expect(html).toContain(">Branding<");
    expect(html).toContain(">Settings<");
  });
});
