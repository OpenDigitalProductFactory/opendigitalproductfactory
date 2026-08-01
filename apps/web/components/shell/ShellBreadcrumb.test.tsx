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

import { ShellBreadcrumb, buildBreadcrumbTrail } from "./ShellBreadcrumb";

function render(path: string) {
  pathname = path;
  return renderToStaticMarkup(<ShellBreadcrumb />);
}

describe("buildBreadcrumbTrail", () => {
  it("walks the canonical parentPath chain to the domain root", () => {
    expect(buildBreadcrumbTrail("/platform/ai/providers")).toEqual([
      { label: "Platform Hub", href: "/platform" },
      { label: "AI Workforce", href: "/platform/ai" },
      { label: "Providers & Routing", href: "/platform/ai/providers" },
    ]);
  });

  it("returns a single crumb for a domain home", () => {
    expect(buildBreadcrumbTrail("/platform")).toEqual([
      { label: "Platform Hub", href: "/platform" },
    ]);
  });

  it("falls back to model labels then title-cased segments for unmodeled routes", () => {
    // /admin is in the model ("Admin"); /admin/settings is not -> title-cased.
    expect(buildBreadcrumbTrail("/admin/settings")).toEqual([
      { label: "Admin", href: "/admin" },
      { label: "Settings", href: "/admin/settings" },
    ]);
  });

  it("title-cases hyphenated unmodeled segments", () => {
    expect(buildBreadcrumbTrail("/admin/reference-data")).toEqual([
      { label: "Admin", href: "/admin" },
      { label: "Reference Data", href: "/admin/reference-data" },
    ]);
  });

  it("decodes an encoded case key before presenting its fallback label", () => {
    expect(buildBreadcrumbTrail("/workspace/cases/backlog-item%3ABI-CCE939AF")).toEqual([
      { label: "Operations", href: "/workspace" },
      { label: "Cases", href: "/workspace/cases" },
      {
        label: "Backlog Item:BI CCE939AF",
        href: "/workspace/cases/backlog-item%3ABI-CCE939AF",
      },
    ]);
  });
});

describe("ShellBreadcrumb", () => {
  it("renders a climbable trail with links for ancestors and aria-current on the leaf", () => {
    const html = render("/platform/ai/providers");
    expect(html).toContain('href="/platform"');
    expect(html).toContain('href="/platform/ai"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">Platform Hub<");
  });

  it("renders nothing on a single-crumb domain home", () => {
    expect(render("/platform")).toBe("");
  });

  it("renders nothing under /portfolio (it has its own breadcrumb)", () => {
    expect(render("/portfolio/product/abc123")).toBe("");
  });
});
