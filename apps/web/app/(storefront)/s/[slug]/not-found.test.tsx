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
});
