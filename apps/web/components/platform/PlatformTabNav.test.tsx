import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/platform";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: () => {} }),
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
import { PLATFORM_FAMILIES } from "@/components/platform/platform-nav";

describe("PlatformTabNav", () => {
  it("renders grouped top-level workflow tabs", () => {
    pathname = "/platform";
    const html = renderToStaticMarkup(<PlatformTabNav />);

    expect(html).toContain(">Overview<");
    expect(html).toContain(">AI Operations<");
    expect(html).toContain(">Tools &amp; Services<");
    expect(html).toContain(">Governance &amp; Audit<");
    // EP-NAV-COHERENCE: the cross-domain "Core Admin" teleport tab was removed.
    expect(html).not.toContain(">Core Admin<");
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

  it("does not expose a Capability Needs tab that redirects out to the Backlog", () => {
    // Capability needs converged into the Backlog (EP-INTAKE-UNIFY); the old route
    // redirects to /ops?origin=capability-need. A secondary-nav tab pointing at it is a
    // cross-section jump (AI Operations → Backlog), so the AI family must not render it.
    pathname = "/platform/ai";
    const html = renderToStaticMarkup(<PlatformTabNav />);

    // The AI family still renders its in-section sub-items…
    expect(html).toContain(">AI Operations<");
    expect(html).toContain('href="/platform/ai/skills"');
    expect(html).toContain('href="/platform/ai/providers"');
    // …but no Capability Needs tab that teleports the operator to /ops.
    expect(html).not.toContain('href="/platform/ai/capability-needs"');
    expect(html).not.toContain(">Capability Needs<");
  });

  it("shows Workforce as the first AI Operations sub-item without a generic Overview peer", () => {
    // EP-26E528F5: the workforce directory is the family front door; Readiness
    // stays one tab away. The label is "Workforce" — a generic "Overview" tab
    // remains banned (it competed with Readiness before EP-COWORKER-RT).
    pathname = "/platform/ai/readiness";
    const html = renderToStaticMarkup(<PlatformTabNav />);

    const aiFamily = PLATFORM_FAMILIES.find((family) => family.key === "ai")!;

    expect(aiFamily.subItems[0]).toEqual({ label: "Workforce", href: "/platform/ai/overview" });
    expect(aiFamily.subItems[1]).toEqual({ label: "Readiness", href: "/platform/ai/readiness" });
    expect(aiFamily.subItems.some((item) => item.label === "Overview")).toBe(false);
    expect(html).toContain(">Readiness<");
    expect(html).toContain(">Workforce<");
  });

  it("uses compact route selectors on mobile while preserving the desktop navigation", () => {
    pathname = "/platform/ai/overview";
    const html = renderToStaticMarkup(<PlatformTabNav />);

    expect(html).toContain('aria-label="Platform area"');
    expect(html).toContain('aria-label="AI Operations view"');
    expect(html).toContain('class="grid gap-2 md:hidden"');
    expect(html).toContain('class="hidden md:block"');
    expect(html).toContain('<option value="/platform/ai" selected="">AI Operations</option>');
    expect(html).toContain('<option value="/platform/ai/overview" selected="">Workforce</option>');
  });

  it("uses compact chrome on the operations map so the visual route map starts sooner", () => {
    pathname = "/platform/ai/operations-map";
    const html = renderToStaticMarkup(<PlatformTabNav />);

    expect(html).toContain("mb-3");
    expect(html).toContain("sr-only");
    expect(html).toContain('href="/platform/ai/operations-map"');
  });
});
