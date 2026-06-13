// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render as renderDom, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { CtaButton } from "./CtaButton";

function render(props: {
  ctaType: string;
  ctaLabel?: string | null;
  priceAmount?: string | null;
}) {
  return renderToStaticMarkup(
    <CtaButton
      ctaType={props.ctaType}
      ctaLabel={props.ctaLabel ?? null}
      orgSlug="acme"
      itemId="item-1"
      priceAmount={props.priceAmount}
    />,
  );
}

function hrefFor(ctaType: string, priceAmount: string | null = "10.00") {
  return render({ ctaType, priceAmount }).match(/href="([^"]+)"/)?.[1] ?? null;
}

function labelFor(props: {
  ctaType: string;
  ctaLabel?: string | null;
  priceAmount?: string | null;
}) {
  cleanup();
  renderDom(
    <CtaButton
      ctaType={props.ctaType}
      ctaLabel={props.ctaLabel ?? null}
      orgSlug="acme"
      itemId="item-1"
      priceAmount={props.priceAmount}
    />,
  );
  return screen.getByRole("link").textContent?.trim() ?? "";
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

describe("CtaButton price-less purchase guard (AUDIT-R3/R4)", () => {
  it("routes a priceless purchase item to the inquiry flow instead of the 404ing order route", () => {
    // The order route 404s when priceAmount is null; the Buy CTA must not lead there.
    expect(hrefFor("purchase", null)).toBe("/s/acme/inquire/item-1");
  });

  it("labels a priceless purchase item 'Enquire', not 'Buy'", () => {
    expect(labelFor({ ctaType: "purchase", priceAmount: null })).toBe("Enquire");
  });

  it("drops a stale 'Buy'-style custom label when downgrading to inquiry", () => {
    expect(labelFor({ ctaType: "purchase", ctaLabel: "Buy now", priceAmount: null })).toBe(
      "Enquire",
    );
  });

  it("keeps the Buy flow once the item carries a price", () => {
    expect(hrefFor("purchase", "25.00")).toBe("/s/acme/order/item-1");
    expect(labelFor({ ctaType: "purchase", priceAmount: "25.00" })).toBe("Buy");
  });

  it("does not downgrade booking/inquiry/donation items that legitimately have no price", () => {
    expect(hrefFor("booking", null)).toBe("/s/acme/book/item-1");
    expect(hrefFor("donation", null)).toBe("/s/acme/donate");
    expect(hrefFor("inquiry", null)).toBe("/s/acme/inquire/item-1");
  });
});
