// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { buildCustomerMap } from "@/lib/crm/customer-map";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/customer-map", () => ({ placeCustomerSiteOnMapAction: vi.fn() }));
vi.mock("@/components/twin/geographic/GeographicSceneCanvas", () => ({
  GeographicSceneCanvas: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));

import { CustomerMapView } from "./CustomerMapView";

const map = buildCustomerMap([
  { siteId: "s1", siteName: "HQ", accountId: "a1", accountName: "Acme", addressLabel: "1 Main", hasAddress: true, latitude: 30, longitude: -97 },
  { siteId: "s2", siteName: "Depot", accountId: "a2", accountName: "Beta", addressLabel: "2 Side", hasAddress: true, latitude: null, longitude: null },
  { siteId: "s3", siteName: "Yard", accountId: "a3", accountName: "Gamma", addressLabel: null, hasAddress: false, latitude: null, longitude: null },
]);

function renderView(canEdit: boolean) {
  return render(
    <MessagesProvider locale="en-US" messages={{ customerMap: namespaceMessages("en-US", "customerMap") }}>
      <CustomerMapView map={map} canEdit={canEdit} />
    </MessagesProvider>,
  );
}

afterEach(cleanup);

describe("CustomerMapView (AC-CMAP-VIEW-1, AC-CMAP-FIX-1)", () => {
  it("shows the map with counts and names every site that is not on it", () => {
    renderView(true);
    expect(screen.getByRole("region", { name: "Map of customer sites" })).toBeTruthy();
    expect(screen.getByText("1 on the map · 2 not on the map")).toBeTruthy();
    expect(screen.getByText("Not on the map (2)")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Check the address" }).map((link) => link.getAttribute("href")))
      .toEqual(["/customer/a2", "/customer/a3"]);
    // A site with no address cannot be pinned; it needs an address first.
    expect(screen.getAllByRole("button", { name: "Place on the map" })).toHaveLength(1);
  });

  it("hides the pin action from people who cannot edit customers", () => {
    renderView(false);
    expect(screen.queryByRole("button", { name: "Place on the map" })).toBeNull();
  });
});
