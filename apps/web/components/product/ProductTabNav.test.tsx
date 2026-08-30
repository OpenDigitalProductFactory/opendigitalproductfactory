import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/portfolio/product/prod-1";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { ProductTabNav } from "@/components/product/ProductTabNav";

describe("ProductTabNav", () => {
  it("renders grouped lifecycle families", () => {
    pathname = "/portfolio/product/prod-1";
    const html = renderToStaticMarkup(<ProductTabNav productId="prod-1" />);

    expect(html).toContain(">Overview<");
    expect(html).toContain(">Delivery<");
    expect(html).toContain(">Operate<");
    expect(html).toContain(">Architecture<");
    expect(html).toContain(">Commercial<");
    expect(html).toContain(">Team<");
    expect(html).not.toContain(">Direction<");
    expect(html).not.toContain(">Backlog<");
    expect(html).not.toContain(">Health<");
  });

  it("shows only the active family's sub-navigation", () => {
    pathname = "/portfolio/product/prod-1/changes";
    const html = renderToStaticMarkup(<ProductTabNav productId="prod-1" />);

    expect(html).toContain('href="/portfolio/product/prod-1/backlog"');
    expect(html).toContain('href="/portfolio/product/prod-1/changes"');
    expect(html).toContain('href="/portfolio/product/prod-1/versions"');
    expect(html).not.toContain(">Health<");
    expect(html).not.toContain(">Offerings<");
  });

  it("consolidates product dependencies, estate, and composition into one destination", () => {
    pathname = "/portfolio/product/prod-1/inventory";
    const html = renderToStaticMarkup(<ProductTabNav productId="prod-1" />);

    expect(html).toContain(">Dependencies<");
    expect(html).not.toContain(">Inventory<");
    expect(html).not.toContain(">Supply Chain<");
    expect(html.match(/href="\/portfolio\/product\/prod-1\/inventory"/g)).toHaveLength(1);
  });
});
