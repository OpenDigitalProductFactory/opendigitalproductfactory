// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const pathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import StorefrontNotFound from "./not-found";

describe("storefront not-found recovery", () => {
  it("recovers a customer URL to the storefront's own surfaces, not workspace/docs", () => {
    pathname.mockReturnValue("/s/copper-kettle/order/itm-123");
    const html = renderToStaticMarkup(<StorefrontNotFound />);
    expect(html).toContain('href="/s/copper-kettle"');
    expect(html).toContain('href="/s/copper-kettle/inquire"');
    expect(html).toContain('href="/s/copper-kettle/sign-in"');
    expect(html).not.toContain("/workspace");
    expect(html).not.toContain("Browse docs");
  });

  it("still offers a safe home link when the slug can't be recovered", () => {
    pathname.mockReturnValue("/s");
    const html = renderToStaticMarkup(<StorefrontNotFound />);
    expect(html).toContain('href="/"');
    // No slug-specific customer links are fabricated.
    expect(html).not.toContain("/inquire");
  });

  // Named scenarios from the BI-B9D54962 acceptance criteria — logic is
  // shared (any /s/<slug>/… miss recovers the same way), but each is asserted
  // explicitly so a regression in one route shape is caught by name.
  it("unknown storefront: recovers via the layout's notFound(), no workspace/docs", () => {
    pathname.mockReturnValue("/s/no-such-storefront");
    const html = renderToStaticMarkup(<StorefrontNotFound />);
    expect(html).toContain('href="/s/no-such-storefront"');
    expect(html).not.toContain("/workspace");
    expect(html).not.toContain("Browse docs");
  });

  it("bad item: recovers to the storefront's own surfaces", () => {
    pathname.mockReturnValue("/s/copper-kettle/item/no-such-item");
    const html = renderToStaticMarkup(<StorefrontNotFound />);
    expect(html).toContain('href="/s/copper-kettle"');
    expect(html).not.toContain("/workspace");
  });

  it("bad booking route: recovers to the storefront's own surfaces", () => {
    pathname.mockReturnValue("/s/copper-kettle/book/no-such-item");
    const html = renderToStaticMarkup(<StorefrontNotFound />);
    expect(html).toContain('href="/s/copper-kettle"');
    expect(html).toContain('href="/s/copper-kettle/inquire"');
    expect(html).not.toContain("/workspace");
  });

  it("invalid checkout ref: recovers to the storefront's own surfaces", () => {
    pathname.mockReturnValue("/s/copper-kettle/checkout");
    const html = renderToStaticMarkup(<StorefrontNotFound />);
    expect(html).toContain('href="/s/copper-kettle"');
    expect(html).not.toContain("/workspace");
    expect(html).not.toContain("Browse docs");
  });
});
