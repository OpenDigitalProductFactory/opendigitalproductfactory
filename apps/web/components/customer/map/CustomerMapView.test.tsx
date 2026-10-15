// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { buildCustomerMap } from "@/lib/crm/customer-map";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/customer-map", () => ({ placeCustomerSiteOnMapAction: vi.fn() }));
vi.mock("@/lib/actions/service-areas", () => ({ saveServiceAreasAction: vi.fn() }));
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

describe("CustomerMapView service areas (BI-6CC10E4C)", () => {
  const ring = (west: number) => [
    { longitude: west, latitude: 25 },
    { longitude: west + 10, latitude: 25 },
    { longitude: west + 10, latitude: 35 },
    { longitude: west, latitude: 35 },
    { longitude: west, latitude: 25 },
  ];
  const withAreas = buildCustomerMap(
    [
      { siteId: "s1", siteName: "HQ", accountId: "a1", accountName: "Acme", addressLabel: "1 Main", hasAddress: true, latitude: 30, longitude: -97 },
      { siteId: "s4", siteName: "Shop", accountId: "a4", accountName: "Delta", addressLabel: "4 Far", hasAddress: true, latitude: 30, longitude: -50 },
    ],
    {
      version: 3,
      zones: [
        { id: "z1", label: "Austin", coveredBy: { kind: "staffing-crew", id: "CREW-1" }, geometry: { kind: "polygon", rings: [ring(-100)] } },
        { id: "z2", label: "Hill country", geometry: { kind: "polygon", rings: [ring(-98)] } },
      ],
      assignees: [{ kind: "staffing-crew", id: "CREW-1", label: "North crew" }],
    },
  );

  function renderAreas(canEdit: boolean, current = withAreas) {
    return render(
      <MessagesProvider locale="en-US" messages={{ customerMap: namespaceMessages("en-US", "customerMap") }}>
        <CustomerMapView map={current} canEdit={canEdit} />
      </MessagesProvider>,
    );
  }

  it("lists sites outside every area, overlaps and who covers each area (AC-COV-ANSWER-1/2)", () => {
    renderAreas(true);
    expect(screen.getByRole("heading", { name: "Coverage" })).toBeTruthy();
    expect(screen.getByText("Outside every service area (1)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Delta · Shop" }).getAttribute("href")).toBe("/customer/a4");
    expect(screen.getByText("In more than one area (1)")).toBeTruthy();
    expect(screen.getByText("Covered by North crew · Sites: 1")).toBeTruthy();
    expect(screen.getByText("Nobody assigned · Sites: 1")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Rename or reassign" })).toHaveLength(2);
  });

  it("starts drawing from Add a service area and keeps Finish disabled below three corners (AC-COV-DRAW-1)", () => {
    renderAreas(true);
    fireEvent.click(screen.getByRole("button", { name: "Add a service area" }));
    expect(screen.getByText("Click the map to add corners. 0 so far.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows areas but no drawing or editing controls without edit permission (AC-COV-DRAW-3)", () => {
    renderAreas(false);
    expect(screen.getByRole("heading", { name: "Coverage" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a service area" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename or reassign" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("adds nothing but the Add control when no area exists (AC-COV-SAFE-1)", () => {
    renderAreas(true, map);
    expect(screen.queryByRole("heading", { name: "Coverage" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add a service area" })).toBeTruthy();
  });
});
