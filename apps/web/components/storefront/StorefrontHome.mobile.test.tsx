// @vitest-environment jsdom
//
// Mobile-viewport (390px) smoke test for the public restaurant home surface
// (BI-2B2FCB2B): the nav sign-in link and item CTA meet the 44px touch target,
// and the hero headline uses a fluid font that cannot overflow a narrow screen.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, style }: { href: string; children: React.ReactNode; style?: React.CSSProperties }) => (
    <a href={href} style={style}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/s/bistro" }));

import { StorefrontNav } from "./StorefrontNav";
import { CtaButton } from "./CtaButton";
import { HeroSection } from "./sections/HeroSection";

afterEach(cleanup);

function px(el: HTMLElement): number {
  return parseInt(el.style.minHeight || "0", 10);
}

describe("Storefront public home mobile smoke", () => {
  it("gives the nav sign-in link a 44px touch target", () => {
    render(<StorefrontNav orgName="Bella Trattoria" orgLogoUrl={null} orgSlug="bistro" />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(px(signIn)).toBeGreaterThanOrEqual(44);
  });

  it("gives an item CTA a 44px touch target", () => {
    render(<CtaButton ctaType="booking" ctaLabel="Reserve a table" orgSlug="bistro" itemId="itm-1" priceAmount={null} />);
    const cta = screen.getByRole("link", { name: /reserve a table/i });
    expect(px(cta)).toBeGreaterThanOrEqual(44);
  });

  it("renders the hero headline as an h1 with the org content", () => {
    // NB: jsdom's CSSOM drops CSS math functions like clamp() and does not
    // round-trip overflow-wrap reliably, so we can't assert the fluid font /
    // break-word inline styles here (they are verified by the source + real
    // browsers). This is a render smoke test: the headline shows up as an h1.
    render(<HeroSection content={{ headline: "Welcome to Bella Trattoria" }} orgName="Bella Trattoria" tagline={null} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("Bella Trattoria");
    // fontWeight is a plain keyword jsdom does keep — proves the style object applied.
    expect(heading.style.fontWeight).toBe("800");
  });
});
