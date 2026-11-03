// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { RegionRecommendation } from "@/lib/twin/map-region-recommendation";
import type { MapPackInstallStatus } from "@/lib/twin/map-pack-install/status";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const installAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/customer-map", () => ({
  saveGeocodingProviderAction: vi.fn(),
  startGeocodingBackfillAction: vi.fn(),
  installRecommendedMapPackAction: installAction,
}));

import { GeocodingAdminPanel } from "./GeocodingAdminPanel";

const bounds = { west: -98, south: 37, east: -96, north: 38 };

function renderPanel(regions: RegionRecommendation | null, install: MapPackInstallStatus | null = null, installRunning = false) {
  return render(
    <MessagesProvider locale="en-US" messages={{ customerMap: namespaceMessages("en-US", "customerMap") }}>
      <GeocodingAdminPanel
        config={{ provider: "none" }}
        opencageKeyConfigured={false}
        status={{ state: "idle", placed: 0, notFound: 0, remaining: null, updatedAt: null }}
        regions={regions}
        install={install}
        installRunning={installRunning}
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

describe("GeocodingAdminPanel street-map install (BI-43BBCC26)", () => {
  const kansas: RegionRecommendation = {
    status: "partly-covered",
    groups: [
      { label: "Texas, United States", regionName: "Texas", countryIso2: "US", suggestedPackId: "us-texas", pointCount: 14, bounds, coveredBy: "us-texas" },
      { label: "Kansas, United States", regionName: "Kansas", countryIso2: "US", suggestedPackId: "us-kansas", pointCount: 3, bounds, coveredBy: null },
    ],
  };
  const status = (over: Partial<MapPackInstallStatus>): MapPackInstallStatus => ({
    state: "idle", packId: null, region: null, chunksDone: 0, chunkCount: 0, totalBytes: 0, error: null, updatedAt: null, ...over,
  });

  it("offers Install only for an uncovered region and installs the recommended pack id", async () => {
    installAction.mockResolvedValue({ ok: true });
    renderPanel(kansas);
    const buttons = screen.getAllByRole("button", { name: /^Install the .* street map$/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe("Install the Kansas, United States street map");
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(installAction).toHaveBeenCalledWith("us-kansas"));
    expect(await screen.findByText("Installing the street map. You can leave this page.")).toBeTruthy();
  });

  it("shows progress and disables Install while a pack is installing", () => {
    renderPanel(kansas, status({ state: "downloading", packId: "us-kansas", region: "Kansas, United States", chunksDone: 3, chunkCount: 12 }), true);
    expect(screen.getByText("Downloading the Kansas, United States street map: part 3 of 12.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Install the Kansas, United States street map" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers Install again when a run stopped making progress", () => {
    renderPanel(kansas, status({ state: "downloading", packId: "us-kansas", region: "Kansas, United States", chunksDone: 3, chunkCount: 12 }), false);
    expect(screen.getByText("The Kansas, United States street map stopped making progress. You can start it again.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Install the Kansas, United States street map" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps one status region mounted so later progress is announced", () => {
    renderPanel(kansas);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("says when the install finished or failed", () => {
    renderPanel(kansas, status({ state: "done", region: "Kansas, United States" }));
    expect(screen.getByText("The Kansas, United States street map is installed.")).toBeTruthy();
    cleanup();
    renderPanel(kansas, status({ state: "failed", region: "Kansas, United States", error: "range read failed (503)" }));
    expect(screen.getByText("The Kansas, United States street map didn't install (range read failed (503)). Try again, or check the map storage has room.")).toBeTruthy();
    cleanup();
    renderPanel(kansas, status({ state: "failed", region: "Kansas, United States" }));
    expect(screen.getByText("The Kansas, United States street map didn't install. Try again.")).toBeTruthy();
  });
});
