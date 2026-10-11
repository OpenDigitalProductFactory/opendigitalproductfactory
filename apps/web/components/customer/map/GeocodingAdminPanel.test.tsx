// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { RegionRecommendation } from "@/lib/twin/map-region-recommendation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/customer-map", () => ({
  saveGeocodingProviderAction: vi.fn(),
  startGeocodingBackfillAction: vi.fn(),
}));

import { GeocodingAdminPanel } from "./GeocodingAdminPanel";

const bounds = { west: -98, south: 37, east: -96, north: 38 };

function renderPanel(regions: RegionRecommendation | null) {
  return render(
    <MessagesProvider locale="en-US" messages={{ customerMap: namespaceMessages("en-US", "customerMap") }}>
      <GeocodingAdminPanel
        config={{ provider: "none" }}
        opencageKeyConfigured={false}
        status={{ state: "idle", placed: 0, notFound: 0, remaining: null, updatedAt: null }}
        regions={regions}
      />
    </MessagesProvider>,
  );
}

afterEach(cleanup);

describe("GeocodingAdminPanel street maps (AC-ALC-REGION-1, AC-ALC-REGION-2)", () => {
  it("names the covering pack and recommends a map for an uncovered region", () => {
    renderPanel({
      status: "partly-covered",
      groups: [
        { label: "Texas, United States", regionName: "Texas", countryIso2: "US", suggestedPackId: "us-texas", pointCount: 14, bounds, coveredBy: "us-texas" },
        { label: "Kansas, United States", regionName: "Kansas", countryIso2: "US", suggestedPackId: "us-kansas", pointCount: 3, bounds, coveredBy: null },
      ],
    });
    expect(screen.getByText("Street maps")).toBeTruthy();
    expect(screen.getByText("Texas, United States: covered by the installed street map us-texas. Placed locations: 14.")).toBeTruthy();
    expect(screen.getByText("Kansas, United States: no street map installed yet. Placed locations: 3. Recommended map: us-kansas.")).toBeTruthy();
  });

  it("says no map is needed when nothing is placed, and shows nothing without a recommendation", () => {
    renderPanel({ status: "no-locations", groups: [] });
    expect(screen.getByText("No locations are placed yet, so no street map is needed.")).toBeTruthy();
    cleanup();
    renderPanel(null);
    expect(screen.queryByText("Street maps")).toBeNull();
  });
});
