import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let pathname = "/customer/marketing";

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

import { MarketingTabNav } from "./MarketingTabNav";

describe("MarketingTabNav", () => {
  it("renders every implemented marketing route", () => {
    pathname = "/customer/marketing";
    const html = renderToStaticMarkup(<MarketingTabNav />);

    expect(html).toContain('href="/customer/marketing"');
    expect(html).toContain('href="/customer/marketing/strategy"');
    expect(html).toContain('href="/customer/marketing/campaigns"');
    expect(html).toContain('href="/customer/marketing/funnel"');
    expect(html).toContain('href="/customer/marketing/automation"');
    expect(html).toContain("Campaigns");
    expect(html).toContain("Funnel");
    expect(html).toContain("Automation");
    expect(html).not.toContain("Phase 2");
    expect(html).not.toContain("Phase 3");
  });

  it("keeps Strategy active for nested strategy routes", () => {
    pathname = "/customer/marketing/strategy";
    const html = renderToStaticMarkup(<MarketingTabNav />);

    expect(html).toContain("border-[var(--dpf-accent)]");
  });

  it("keeps Campaigns active for nested campaign routes", () => {
    pathname = "/customer/marketing/campaigns/briefs";
    const html = renderToStaticMarkup(<MarketingTabNav />);

    expect(html).toContain('href="/customer/marketing/campaigns"');
    expect(html).toContain("border-[var(--dpf-accent)]");
  });
});
