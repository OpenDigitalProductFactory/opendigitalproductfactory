import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/finance";

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

import { FinanceTabNav } from "@/components/finance/FinanceTabNav";

describe("FinanceTabNav", () => {
  it("renders grouped top-level workflow tabs", () => {
    pathname = "/finance";
    const html = renderToStaticMarkup(<FinanceTabNav />);

    expect(html).toContain(">Overview<");
    expect(html).toContain(">Revenue<");
    expect(html).toContain(">Spend<");
    expect(html).toContain(">Close<");
    expect(html).toContain(">Configuration<");
    expect(html).not.toContain(">Invoices<");
    expect(html).not.toContain(">Bills<");
  });

  it("shows only the active family's sub-navigation", () => {
    pathname = "/finance/reports";
    const html = renderToStaticMarkup(<FinanceTabNav />);

    expect(html).toContain('href="/finance/close"');
    expect(html).toContain('href="/finance/reports"');
    expect(html).toContain('href="/finance/recurring"');
    expect(html).toContain('href="/finance/payment-runs"');
    expect(html).not.toContain('href="/finance/invoices"');
    expect(html).not.toContain('href="/finance/bills"');
  });

  it("shows tax remittance in the configuration sub-navigation", () => {
    pathname = "/finance/settings/tax";
    const html = renderToStaticMarkup(<FinanceTabNav />);

    expect(html).toContain('href="/finance/settings"');
    expect(html).toContain('href="/finance/settings/currency"');
    expect(html).toContain('href="/finance/settings/dunning"');
    expect(html).toContain('href="/finance/settings/tax"');
  });
});
