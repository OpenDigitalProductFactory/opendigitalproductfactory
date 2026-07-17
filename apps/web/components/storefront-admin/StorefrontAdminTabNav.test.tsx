import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/storefront";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { StorefrontAdminTabNav } from "@/components/storefront-admin/StorefrontAdminTabNav";

const vocabulary = {
  itemsLabel: "Assessments & Services",
  singleItemLabel: "Service",
  addButtonLabel: "Add service",
  categoryLabel: "Category",
  priceLabel: "Fee",
  portalLabel: "Community Portal",
  stakeholderLabel: "Homeowners",
  teamLabel: "Board & Contractors",
  inboxLabel: "Requests",
  agentName: "Community Manager",
};

describe("StorefrontAdminTabNav", () => {
  it("uses /storefront as the canonical portal management route", () => {
    pathname = "/storefront";
    const html = renderToStaticMarkup(<StorefrontAdminTabNav vocabulary={vocabulary} />);

    expect(html).toContain('href="/storefront"');
    expect(html).toContain('href="/storefront/sections"');
    expect(html).toContain('href="/storefront/items"');
    expect(html).toContain('href="/storefront/team"');
    expect(html).toContain('href="/storefront/inbox"');
    expect(html).toContain('href="/storefront/settings"');
    expect(html).not.toContain('href="/admin/storefront"');
  });

  it("renders archetype-aware labels on the business-side tabs", () => {
    pathname = "/storefront/team";
    const html = renderToStaticMarkup(<StorefrontAdminTabNav vocabulary={vocabulary} />);

    expect(html).toContain(">Dashboard<");
    expect(html).toContain(">Sections<");
    expect(html).toContain(">Assessments &amp; Services<");
    expect(html).toContain(">Board &amp; Contractors<");
    expect(html).toContain(">Requests<");
    expect(html).toContain(">Settings<");
  });

  it("shows Intake only when the healthcare workspace enables it", () => {
    pathname = "/storefront/intake";
    const healthcareHtml = renderToStaticMarkup(
      <StorefrontAdminTabNav vocabulary={vocabulary} showIntake />,
    );
    const generalHtml = renderToStaticMarkup(
      <StorefrontAdminTabNav vocabulary={vocabulary} />,
    );

    expect(healthcareHtml).toContain('href="/storefront/intake"');
    expect(healthcareHtml).toContain(">Intake<");
    expect(generalHtml).not.toContain('href="/storefront/intake"');
  });
});
