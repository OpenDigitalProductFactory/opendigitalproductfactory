import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { CtaButton } from "./CtaButton";

function hrefFor(ctaType: string) {
  const html = renderToStaticMarkup(
    <CtaButton ctaType={ctaType} ctaLabel={null} orgSlug="acme" itemId="item-1" />,
  );
  return html.match(/href="([^"]+)"/)?.[1] ?? null;
}

describe("CtaButton routing", () => {
  it("points the purchase CTA at the real order route, not a dead /cart link", () => {
    expect(hrefFor("purchase")).toBe("/s/acme/order/item-1");
  });

  it("keeps the other CTAs on their existing routes", () => {
    expect(hrefFor("booking")).toBe("/s/acme/book/item-1");
    expect(hrefFor("donation")).toBe("/s/acme/donate");
    expect(hrefFor("inquiry")).toBe("/s/acme/inquire/item-1");
  });
});
