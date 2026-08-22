// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StorefrontDashboard } from "./StorefrontDashboard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => cleanup());
beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

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

  it("publishes a nonprofit Supporter Hub to supporters", () => {
    render(
      <StorefrontDashboard
        config={{
          ...baseConfig,
          isPublished: false,
          portalLabel: "Supporter Hub",
          stakeholderLabel: "Supporters",
        }}
        counts={counts}
      />,
    );

    expect(screen.getByText(/your supporter hub is ready/i)).toBeTruthy();
    expect(screen.getByText(/publish it so supporters can find you/i)).toBeTruthy();
    expect(screen.queryByText(/customers can find you/i)).toBeNull();
  });

  it("refreshes the server shell after publishing so onboarding advances immediately", async () => {
    render(<StorefrontDashboard config={{ ...baseConfig, isPublished: false }} counts={counts} />);

    fireEvent.click(screen.getByRole("button", { name: /publish now/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
