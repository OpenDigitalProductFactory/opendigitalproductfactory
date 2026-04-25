import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/platform/tools/catalog";

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

import { ToolsTabNav } from "@/components/platform/ToolsTabNav";

describe("ToolsTabNav", () => {
  it("renders the full tools and integrations sub-navigation", () => {
    pathname = "/platform/tools/catalog";
    const html = renderToStaticMarkup(<ToolsTabNav />);

    expect(html).toContain('href="/platform/tools/catalog"');
    expect(html).toContain('href="/platform/tools/services"');
    expect(html).toContain('href="/platform/tools/integrations"');
    expect(html).toContain('href="/platform/tools/built-ins"');
    expect(html).toContain('href="/platform/tools/discovery"');
    expect(html).toContain('href="/platform/tools/inventory"');
    expect(html).toContain(">Native Integrations<");
  });

  it("marks native integrations active when viewing a native integration route", () => {
    pathname = "/platform/tools/integrations/facebook-lead-ads";
    const html = renderToStaticMarkup(<ToolsTabNav />);

    expect(html).toContain('href="/platform/tools/integrations"');
    expect(html).toContain("border-b-2 border-[var(--dpf-accent)]");
  });

  it("keeps other tabs inactive on deeper native integration routes", () => {
    pathname = "/platform/tools/integrations/facebook-lead-ads";
    const html = renderToStaticMarkup(<ToolsTabNav />);

    expect(html).toContain(
      'href="/platform/tools/catalog" class="px-3 py-1.5 text-xs font-medium rounded-t transition-colors text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"',
    );
    expect(html).not.toContain(
      'href="/platform/tools/catalog" class="px-3 py-1.5 text-xs font-medium rounded-t transition-colors text-[var(--dpf-text)] border-b-2 border-[var(--dpf-accent)]"',
    );
  });
});
