// @vitest-environment jsdom
//
// The storefront nav's "Sign in" link must carry the current page as
// `returnTo` so a customer who steps out mid-browse (an item/booking/inquiry
// page) lands back where they were after auth, not on the internal /portal
// (BI-CC4BEB5F).

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const pathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));
vi.mock("next/link", () => ({
  default: ({ href, children, style }: { href: string; children: React.ReactNode; style?: React.CSSProperties }) => (
    <a href={href} style={style}>{children}</a>
  ),
}));

import { StorefrontNav } from "./StorefrontNav";

afterEach(() => cleanup());

describe("StorefrontNav sign-in returnTo threading", () => {
  it("carries the current item/booking page as returnTo on the sign-in link", () => {
    pathname.mockReturnValue("/s/bistro/book/itm-42");
    render(<StorefrontNav orgName="Bella Trattoria" orgLogoUrl={null} orgSlug="bistro" />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn).toHaveAttribute(
      "href",
      "/s/bistro/sign-in?returnTo=%2Fs%2Fbistro%2Fbook%2Fitm-42",
    );
  });

  it("does not add a returnTo when already on an auth page (avoids a self-loop)", () => {
    pathname.mockReturnValue("/s/bistro/sign-in");
    render(<StorefrontNav orgName="Bella Trattoria" orgLogoUrl={null} orgSlug="bistro" />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn).toHaveAttribute("href", "/s/bistro/sign-in");
  });

  it("falls back to a plain sign-in link when pathname is unavailable", () => {
    pathname.mockReturnValue("");
    render(<StorefrontNav orgName="Bella Trattoria" orgLogoUrl={null} orgSlug="bistro" />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn).toHaveAttribute("href", "/s/bistro/sign-in");
  });
});
