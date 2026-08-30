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

import { getGrantedCapabilities } from "@/lib/permissions";
import { ShellBreadcrumb, buildBreadcrumbTrail } from "./ShellBreadcrumb";

// The real registry, not a second list — the whole point of the fix.
const granted = (platformRole: string | null, isSuperuser = false) =>
  getGrantedCapabilities({ userId: "u1", platformRole, isSuperuser }) as string[];

const ADMIN = new Set(granted(null, true));
const OPERATIONS_MANAGER = new Set(granted("HR-500"));
const WORKFORCE_MEMBER = new Set(granted("HR-600"));

function render(path: string, capabilities: ReadonlySet<string> = ADMIN) {
  pathname = path;
  return renderToStaticMarkup(
    <ShellBreadcrumb capabilities={[...capabilities]} />,
  );
}

describe("buildBreadcrumbTrail", () => {
  it("walks the canonical parentPath chain to the domain root", () => {
    expect(buildBreadcrumbTrail("/platform/ai/providers", ADMIN)).toEqual([
      { label: "Platform Hub", href: "/platform" },
      { label: "AI Workforce", href: "/platform/ai" },
      { label: "Providers & Routing", href: "/platform/ai/providers" },
    ]);
  });

  it("returns a single crumb for a domain home", () => {
    expect(buildBreadcrumbTrail("/platform", ADMIN)).toEqual([
      { label: "Platform Hub", href: "/platform" },
    ]);
  });

  it("falls back to model labels then title-cased segments for unmodeled routes", () => {
    // /admin is in the model ("Admin"); /admin/settings is not -> title-cased.
    expect(buildBreadcrumbTrail("/admin/settings", ADMIN)).toEqual([
      { label: "Admin", href: "/admin" },
      { label: "Settings", href: "/admin/settings" },
    ]);
  });

  it("title-cases hyphenated unmodeled segments", () => {
    expect(buildBreadcrumbTrail("/admin/reference-data", ADMIN)).toEqual([
      { label: "Admin", href: "/admin" },
      { label: "Reference Data", href: "/admin/reference-data" },
    ]);
  });

  it("decodes an encoded case key before presenting its fallback label", () => {
    expect(buildBreadcrumbTrail("/workspace/cases/backlog-item%3ABI-CCE939AF", ADMIN)).toEqual([
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

// An HR-500 Operations Manager and an HR-600 Workforce Member were both offered
// a "Portal" crumb to /storefront and both got 404 from the page behind it: the
// rail filtered on view_storefront and the trail filtered on nothing
// (BI-2777B86B). The reachability defect itself stays with BI-4F8A484C — this
// is only the product no longer advertising a door these roles cannot open.
describe("a crumb is only offered to a principal who can open it", () => {
  const portalCrumb = { label: "Portal", href: "/storefront" };

  it("offers the Portal ancestor to an admin", () => {
    expect(buildBreadcrumbTrail("/storefront/animals", ADMIN)).toContainEqual(portalCrumb);
  });

  it("withholds it from an Operations Manager, who is refused the page", () => {
    expect(
      buildBreadcrumbTrail("/storefront/animals", OPERATIONS_MANAGER),
    ).not.toContainEqual(portalCrumb);
  });

  it("withholds it from a Workforce Member, who is refused the page", () => {
    expect(
      buildBreadcrumbTrail("/storefront/animals", WORKFORCE_MEMBER),
    ).not.toContainEqual(portalCrumb);
  });

  it("renders no Portal link for either role", () => {
    expect(render("/storefront/animals", OPERATIONS_MANAGER)).not.toContain(
      'href="/storefront"',
    );
    expect(render("/storefront/animals", WORKFORCE_MEMBER)).not.toContain(
      'href="/storefront"',
    );
  });

  it("still gives every role the ancestors it can reach", () => {
    expect(buildBreadcrumbTrail("/workspace/cases", WORKFORCE_MEMBER)).toContainEqual({
      label: "Operations",
      href: "/workspace",
    });
  });
});
