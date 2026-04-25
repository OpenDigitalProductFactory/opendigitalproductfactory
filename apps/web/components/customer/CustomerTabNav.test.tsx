import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/customer";

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

import { CustomerTabNav } from "@/components/customer/CustomerTabNav";

describe("CustomerTabNav", () => {
  it("renders both CRM and Marketing tabs when the user can access both", () => {
    pathname = "/customer";
    const html = renderToStaticMarkup(
      <CustomerTabNav
        tabs={[
          { label: "Accounts", href: "/customer" },
          { label: "Engagements", href: "/customer/engagements" },
          { label: "Marketing", href: "/customer/marketing" },
        ]}
      />,
    );

    expect(html).toContain('href="/customer"');
    expect(html).toContain('href="/customer/engagements"');
    expect(html).toContain('href="/customer/marketing"');
    expect(html).toContain(">Marketing<");
  });

  it("renders only the Marketing tab for marketing-only users", () => {
    pathname = "/customer/marketing";
    const html = renderToStaticMarkup(
      <CustomerTabNav tabs={[{ label: "Marketing", href: "/customer/marketing" }]} />,
    );

    expect(html).toContain('href="/customer/marketing"');
    expect(html).toContain(">Marketing<");
    expect(html).not.toContain(">Accounts<");
    expect(html).toContain("border-[var(--dpf-accent)]");
  });

  it("keeps Marketing active for nested marketing routes", () => {
    pathname = "/customer/marketing/strategy";
    const html = renderToStaticMarkup(
      <CustomerTabNav
        tabs={[
          { label: "Accounts", href: "/customer" },
          { label: "Marketing", href: "/customer/marketing" },
        ]}
      />,
    );

    expect(html).toContain('href="/customer/marketing"');
    expect(html).toContain("border-[var(--dpf-accent)]");
  });
});
