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
  it("renders only implemented marketing routes", () => {
    pathname = "/customer/marketing";
    const html = renderToStaticMarkup(<MarketingTabNav />);

    expect(html).toContain('href="/customer/marketing"');
    expect(html).toContain('href="/customer/marketing/strategy"');
    expect(html).not.toContain("Campaigns");
    expect(html).not.toContain("Funnel");
    expect(html).not.toContain("Automation");
    expect(html).not.toContain("Phase 2");
    expect(html).not.toContain("Phase 3");
  });

  it("keeps Strategy active for nested strategy routes", () => {
    pathname = "/customer/marketing/strategy";
    const html = renderToStaticMarkup(<MarketingTabNav />);

    expect(html).toContain("border-[var(--dpf-accent)]");
  });
});
