// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StorefrontDashboard } from "./StorefrontDashboard";

afterEach(() => cleanup());

const baseConfig = {
  id: "sf-1",
  tagline: "Best in town",
  orgSlug: "glamour-grace",
  orgName: "Glamour & Grace",
  archetypeId: "hair-salon",
  ctaType: "booking",
  sectionCount: 4,
  itemCount: 6,
};
const counts = { inquiries: 0, bookings: 0, orders: 0, donations: 0 };

describe("StorefrontDashboard publish CTA", () => {
  it("shows a prominent publish call-to-action when the portal is unpublished", () => {
    render(<StorefrontDashboard config={{ ...baseConfig, isPublished: false }} counts={counts} />);
    expect(screen.getByText(/your storefront is ready — publish it now/i)).toBeTruthy();
    expect(screen.getByText(/publish now/i)).toBeTruthy();
  });

  it("hides the call-to-action once the portal is published", () => {
    render(<StorefrontDashboard config={{ ...baseConfig, isPublished: true }} counts={counts} />);
    expect(screen.queryByText(/your storefront is ready — publish it now/i)).toBeNull();
  });
});
