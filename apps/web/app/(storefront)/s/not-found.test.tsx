// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const pathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import StorefrontTokenNotFound from "./not-found";

// Covers the token-addressed public routes that sit as SIBLINGS of
// `s/[slug]`, not descendants of it, so `s/[slug]/not-found.tsx` never
// catches them (BI-B9D54962). Before this boundary existed, a bad quote or
// payment token fell through to the global operator 404.
describe("storefront token-route not-found recovery", () => {
  it("explains a bad quote token in customer language, not workspace/docs", () => {
    pathname.mockReturnValue("/s/quote/no-such-token");
    const html = renderToStaticMarkup(<StorefrontTokenNotFound />);
    expect(html).toMatch(/quote link is not valid/i);
    expect(html).toMatch(/expired|already been used/i);
    expect(html).toContain('href="/"');
    expect(html).not.toContain("/workspace");
    expect(html).not.toContain("Browse docs");
  });

  it("explains a bad payment token in customer language, not workspace/docs", () => {
    pathname.mockReturnValue("/s/pay/no-such-token");
    const html = renderToStaticMarkup(<StorefrontTokenNotFound />);
    expect(html).toMatch(/payment link is not valid/i);
    expect(html).not.toContain("/workspace");
    expect(html).not.toContain("Browse docs");
  });

  it("explains a bad approval token distinctly from an expense approval token", () => {
    pathname.mockReturnValue("/s/approve/no-such-token");
    let html = renderToStaticMarkup(<StorefrontTokenNotFound />);
    expect(html).toMatch(/approval link is not valid/i);

    pathname.mockReturnValue("/s/expense-approve/no-such-token");
    html = renderToStaticMarkup(<StorefrontTokenNotFound />);
    expect(html).toMatch(/expense approval link is not valid/i);
  });
});
