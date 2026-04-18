import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/storefront/settings";

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

import { StorefrontSettingsNav } from "@/components/storefront-admin/StorefrontSettingsNav";

describe("StorefrontSettingsNav", () => {
  it("renders Business-side settings routes as the canonical home", () => {
    pathname = "/storefront/settings/business";
    const html = renderToStaticMarkup(<StorefrontSettingsNav />);

    expect(html).toContain('href="/storefront/settings"');
    expect(html).toContain('href="/storefront/settings/business"');
    expect(html).toContain('href="/storefront/settings/operations"');
    expect(html).toContain(">Portal<");
    expect(html).toContain(">Your Business<");
    expect(html).toContain(">Operating Hours<");
    expect(html).not.toContain('href="/admin/business-context"');
    expect(html).not.toContain('href="/admin/operating-hours"');
  });
});
