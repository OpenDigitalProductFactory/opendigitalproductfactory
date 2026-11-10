// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { GeographicSceneModel } from "@/lib/twin/geographic-scene";

import {
  ensureGeographicEngine,
  fallbackMessageKey,
  GeographicSceneCanvas,
  MAP_WORKER_URL,
  resetGeographicEngineForTests,
} from "./GeographicSceneCanvas";

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

const model: GeographicSceneModel = {
  viewport: { center: { longitude: -97.7, latitude: 30.3 }, zoom: 12 },
  bounds: { west: -97.8, south: 30.2, east: -97.6, north: 30.4, crossesAntimeridian: false },
  zones: { type: "FeatureCollection", features: [] },
  placements: { type: "FeatureCollection", features: [] },
} as unknown as GeographicSceneModel;

const texas = {
  packId: "us-texas",
  attribution: "© OpenStreetMap contributors",
  bounds: { west: -107, south: 25, east: -93, north: 37 },
};

function fakeEngine() {
  const canvas = { style: { cursor: "" } };
  const instance = {
    getCanvas: vi.fn(() => canvas),
    on: vi.fn(),
    once: vi.fn(),
    remove: vi.fn(),
    setStyle: vi.fn(),
    getSource: vi.fn(),
    isStyleLoaded: vi.fn(() => false),
  };
  const Map = vi.fn(function MapCtor(options: unknown) {
    // Like MapLibre, mark the container it takes over.
    (options as { container: HTMLElement }).container.classList.add("maplibregl-map");
    return instance;
  });
  return { module: { Map } as never, instance, Map, canvas };
}

function renderCanvas(props: Partial<Parameters<typeof GeographicSceneCanvas>[0]>) {
  return render(
    <MessagesProvider locale="en-US" messages={{ geographic: namespaceMessages("en-US", "geographic") }}>
      <GeographicSceneCanvas model={model} label="Service area map" {...props} />
    </MessagesProvider>,
  );
}

afterEach(() => {
  cleanup();
  resetGeographicEngineForTests();
});

describe("fallbackMessageKey", () => {
  it("names each state that cannot draw, and none when ready", () => {
    expect(fallbackMessageKey({ state: "webgl-unavailable" })).toBe("map.webglUnavailable");
    expect(fallbackMessageKey({ state: "region-pack-missing" })).toBe("map.packMissing");
    expect(fallbackMessageKey({ state: "region-out-of-coverage" })).toBe("map.outOfCoverage");
    expect(fallbackMessageKey({ state: "renderer-ready", pack: null })).toBeNull();
  });
});

describe("ensureGeographicEngine", () => {
  it("serves the worker first-party and registers pmtiles:// exactly once", async () => {
    const setWorkerUrl = vi.fn();
    const addProtocol = vi.fn();
    const Protocol = vi.fn(function ProtocolCtor() {
      return { tile: "tile-loader" };
    });
    const importers = {
      maplibre: vi.fn(async () => ({ setWorkerUrl, addProtocol }) as never),
      pmtiles: vi.fn(async () => ({ Protocol }) as never),
    };
    await ensureGeographicEngine(importers);
    await ensureGeographicEngine(importers);
    expect(importers.maplibre).toHaveBeenCalledTimes(1);
    expect(setWorkerUrl).toHaveBeenCalledWith(MAP_WORKER_URL);
    expect(addProtocol).toHaveBeenCalledTimes(1);
    expect(addProtocol).toHaveBeenCalledWith("pmtiles", "tile-loader");
  });
});

describe("GeographicSceneCanvas", () => {
  it("says why when the browser cannot draw maps, without loading the engine", async () => {
    const loadEngine = vi.fn();
    renderCanvas({ detectWebGL: () => false, loadEngine, loadPacks: async () => [] });
    expect(await screen.findByText(/cannot draw maps/)).toBeTruthy();
    expect(loadEngine).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Service area map" })).toBeTruthy();
  });

  it("says when no street map is installed and the view needs one", async () => {
    renderCanvas({ detectWebGL: () => true, loadEngine: vi.fn(), loadPacks: async () => [], requiresBasemap: true });
    expect(await screen.findByText(/No street map is installed/)).toBeTruthy();
  });

  it("says when the installed packs do not cover the area", async () => {
    const elsewhere = { ...texas, packId: "fr-paris", bounds: { west: 2, south: 48, east: 3, north: 49 } };
    renderCanvas({ detectWebGL: () => true, loadEngine: vi.fn(), loadPacks: async () => [elsewhere], requiresBasemap: true });
    expect(await screen.findByText(/do not cover this area/)).toBeTruthy();
  });

  it("draws with the covering pack and removes the map on unmount", async () => {
    const engine = fakeEngine();
    const loadEngine = vi.fn(async () => engine.module);
    const view = renderCanvas({ detectWebGL: () => true, loadEngine, loadPacks: async () => [texas] });
    await waitFor(() => expect(engine.Map).toHaveBeenCalledTimes(1));
    const options = engine.Map.mock.calls[0][0] as { style: { sources: Record<string, unknown> }; bounds: unknown };
    expect(options.style.sources["dpf-basemap"]).toMatchObject({ url: expect.stringContaining("/api/map-assets/us-texas") });
    expect(options.bounds).toEqual([[-97.8, 30.2], [-97.6, 30.4]]);
    expect(screen.queryByText(/cannot draw|No street map|do not cover/)).toBeNull();
    view.unmount();
    expect(engine.instance.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps MapLibre's container class when placing turns on and off, and sets the cursor on its canvas", async () => {
    const engine = fakeEngine();
    const loadEngine = vi.fn(async () => engine.module);
    const props = { detectWebGL: () => true, loadEngine, loadPacks: async () => [texas] };
    const view = renderCanvas({ ...props, onPlacePoint: vi.fn() });
    await waitFor(() => expect(engine.Map).toHaveBeenCalledTimes(1));
    const container = screen.getByTestId("geographic-scene-canvas");
    await waitFor(() => expect(engine.canvas.style.cursor).toBe("crosshair"));

    view.rerender(
      <MessagesProvider locale="en-US" messages={{ geographic: namespaceMessages("en-US", "geographic") }}>
        <GeographicSceneCanvas model={model} label="Service area map" {...props} onPlacePoint={null} />
      </MessagesProvider>,
    );
    expect(container.classList.contains("maplibregl-map")).toBe(true);
    expect(engine.canvas.style.cursor).toBe("");
    expect(engine.Map).toHaveBeenCalledTimes(1);
  });

  it("reports a failure to load the engine instead of a blank canvas", async () => {
    renderCanvas({
      detectWebGL: () => true,
      loadEngine: vi.fn(async () => {
        throw new Error("chunk failed");
      }),
      loadPacks: async () => [],
    });
    expect(await screen.findByText(/could not be drawn/)).toBeTruthy();
  });
});
