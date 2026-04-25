import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/platform";

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

import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

describe("PlatformTabNav", () => {
  it("renders grouped top-level workflow tabs", () => {
    pathname = "/platform";
    const html = renderToStaticMarkup(<PlatformTabNav />);

    expect(html).toContain(">Overview<");
    expect(html).toContain(">AI Operations<");
    expect(html).toContain(">Tools &amp; Services<");
    expect(html).toContain(">Governance &amp; Audit<");
    expect(html).toContain(">Core Admin<");
    expect(html).not.toContain(">Catalog<");
    expect(html).not.toContain(">Ledger<");
  });

  it("shows only the active family's sub-navigation", () => {
    pathname = "/platform/tools/discovery";
    const html = renderToStaticMarkup(<PlatformTabNav />);

    expect(html).toContain('href="/platform/tools"');
    expect(html).toContain('href="/platform/tools/catalog"');
    expect(html).toContain('href="/platform/tools/integrations"');
    expect(html).toContain('href="/platform/tools/discovery"');
    expect(html).toContain('href="/platform/tools/services"');
    expect(html).toContain('href="/platform/tools/inventory"');
    expect(html).toContain(">MCP Catalog<");
    expect(html).toContain(">MCP Services<");
    expect(html).toContain(">Native Integrations<");
    expect(html).toContain(">Built-in Tools<");
    expect(html).toContain(">Estate Discovery<");
    expect(html).not.toContain(">Discovery Operations<");
    expect(html).not.toContain('href="/platform/ai/providers"');
    expect(html).not.toContain('href="/platform/audit/ledger"');
  });
});
