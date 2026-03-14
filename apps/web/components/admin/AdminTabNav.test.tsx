import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/agents",
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { AdminTabNav } from "@/components/admin/AdminTabNav";

describe("AdminTabNav", () => {
  it("renders Access and Agents tabs", () => {
    const html = renderToStaticMarkup(<AdminTabNav />);

    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/agents"');
    expect(html).toContain(">Access<");
    expect(html).toContain(">Agents<");
  });
});
