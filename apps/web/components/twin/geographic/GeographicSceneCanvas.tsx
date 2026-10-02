"use client";

// Interactive map for a geographic scene (BI-814F86E1, design §2.4–2.5,
// AC-GEO-RENDER-1, AC-GEO-DEGRADE-1, AC-GEO-ISOLATE-1).
//
// MapLibre and PMTiles load by dynamic import only when this mounts, so no
// other route carries them. The map is an enhancement: callers always render
// their own accessible list, and when the map cannot draw this says why
// instead of showing a blank canvas.

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";

import type { GeographicSceneModel } from "@/lib/twin/geographic-scene";
import { useT } from "@/lib/i18n/use-t";

import {
  geographicRendererCapability,
  type GeographicRendererCapability,
  type InstalledPack,
} from "./geographic-capability";
import {
  buildGeographicStyle,
  GEOGRAPHIC_SOURCE_IDS,
  GEOGRAPHIC_TOKEN_VARIABLES,
  type GeographicStyleTokens,
} from "./geographic-style";

type MapLibreModule = typeof import("maplibre-gl");
type PMTilesModule = typeof import("pmtiles");
export type InstalledPackManifest = InstalledPack & { attribution: string };

export const MAP_WORKER_URL = "/api/map-assets/runtime/maplibre-gl-worker.mjs";
let engine: Promise<MapLibreModule> | null = null;

/**
 * Loads MapLibre once per page lifetime: the worker comes from the install,
 * and the pmtiles:// protocol is registered exactly once.
 */
export function ensureGeographicEngine(
  importers: { maplibre: () => Promise<MapLibreModule>; pmtiles: () => Promise<PMTilesModule> } = {
    maplibre: () => import("maplibre-gl"),
    pmtiles: () => import("pmtiles"),
  },
): Promise<MapLibreModule> {
  engine ??= Promise.all([importers.maplibre(), importers.pmtiles()]).then(([maplibre, pmtiles]) => {
    maplibre.setWorkerUrl(MAP_WORKER_URL);
    const protocol = new pmtiles.Protocol();
    maplibre.addProtocol("pmtiles", protocol.tile);
    return maplibre;
  });
  return engine;
}

/** Test seam: forget the loaded engine. */
export function resetGeographicEngineForTests(): void {
  engine = null;
}

function readTokens(element: Element): GeographicStyleTokens {
  const computed = getComputedStyle(element);
  const entries = Object.entries(GEOGRAPHIC_TOKEN_VARIABLES).map(([key, variable]) => [
    key,
    computed.getPropertyValue(variable).trim(),
  ]);
  return Object.fromEntries(entries) as GeographicStyleTokens;
}

function browserSupportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

async function fetchInstalledPacks(): Promise<InstalledPackManifest[]> {
  const response = await fetch("/api/map-assets", { credentials: "same-origin" });
  if (!response.ok) return [];
  const body = (await response.json()) as { packs?: InstalledPackManifest[] };
  return body.packs ?? [];
}

export type FallbackKey = "map.webglUnavailable" | "map.packMissing" | "map.outOfCoverage";

export function fallbackMessageKey(capability: GeographicRendererCapability): FallbackKey | null {
  switch (capability.state) {
    case "webgl-unavailable":
      return "map.webglUnavailable";
    case "region-pack-missing":
      return "map.packMissing";
    case "region-out-of-coverage":
      return "map.outOfCoverage";
    default:
      return null;
  }
}

type Phase = { kind: "loading" } | { kind: "failed" } | { kind: "resolved"; capability: GeographicRendererCapability };

export function GeographicSceneCanvas({
  model,
  label,
  onSelectEntity,
  onPlacePoint = null,
  requiresBasemap = false,
  className,
  loadEngine = ensureGeographicEngine,
  loadPacks = fetchInstalledPacks,
  detectWebGL = browserSupportsWebGL,
}: {
  model: GeographicSceneModel;
  /** Accessible name for the map region. */
  label: string;
  onSelectEntity?: (entityId: string | null) => void;
  /** While set, a click on the map reports that point instead of selecting (manual pin). */
  onPlacePoint?: ((latitude: number, longitude: number) => void) | null;
  /** True when the view is meaningless without a street layer. */
  requiresBasemap?: boolean;
  className?: string;
  loadEngine?: () => Promise<MapLibreModule>;
  loadPacks?: () => Promise<InstalledPackManifest[]>;
  detectWebGL?: () => boolean;
}) {
  const t = useT("geographic");
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const latestModel = useRef(model);
  const onSelect = useRef(onSelectEntity);
  const onPlace = useRef(onPlacePoint);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  latestModel.current = model;
  onSelect.current = onSelectEntity;
  onPlace.current = onPlacePoint;

  const bounds = model.bounds;
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    const element = container.current;
    if (!element) return;

    const pushData = (instance: MapLibreMap) => {
      const current = latestModel.current;
      (instance.getSource(GEOGRAPHIC_SOURCE_IDS.zones) as GeoJSONSource | undefined)?.setData(current.zones);
      (instance.getSource(GEOGRAPHIC_SOURCE_IDS.placements) as GeoJSONSource | undefined)?.setData(current.placements);
    };

    (async () => {
      const webgl = detectWebGL();
      const packs = webgl ? await loadPacks().catch(() => []) : [];
      const capability = geographicRendererCapability({ webgl, packs, bounds, requiresBasemap });
      if (cancelled) return;
      setPhase({ kind: "resolved", capability });
      if (capability.state !== "renderer-ready") return;

      const maplibre = await loadEngine();
      if (cancelled) return;
      const pack = capability.pack ? packs.find((entry) => entry.packId === capability.pack?.packId) : undefined;
      const style = () =>
        buildGeographicStyle({
          tokens: readTokens(element),
          origin: window.location.origin,
          pack: pack ? { packId: pack.packId, attribution: pack.attribution } : undefined,
        });
      const instance = new maplibre.Map({
        container: element,
        style: style(),
        bounds: [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        fitBoundsOptions: { padding: 32, maxZoom: 17 },
        attributionControl: { compact: true },
      });
      map.current = instance;
      instance.on("load", () => pushData(instance));
      instance.on("click", "dpf-placements", (event) => {
        if (onPlace.current) return;
        const entityId = event.features?.[0]?.properties?.entityId;
        onSelect.current?.(typeof entityId === "string" ? entityId : null);
      });
      instance.on("click", (event) => {
        onPlace.current?.(event.lngLat.lat, event.lngLat.lng);
      });
      // Rebuild the style when the theme changes; sources come back empty, so refill them.
      observer = new MutationObserver(() => {
        instance.setStyle(style());
        instance.once("style.load", () => pushData(instance));
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    })().catch(() => {
      if (!cancelled) setPhase({ kind: "failed" });
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, [bounds.west, bounds.south, bounds.east, bounds.north, requiresBasemap, loadEngine, loadPacks, detectWebGL]);

  // The crosshair goes on MapLibre's own canvas. The container's className must
  // never change after mount: React would overwrite the classes MapLibre adds
  // to it (maplibregl-map), and the canvas would lose its positioning.
  const placing = Boolean(onPlacePoint);
  useEffect(() => {
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = placing ? "crosshair" : "";
  }, [placing, phase]);

  // New zones, placements or selection: refill the sources without rebuilding the map.
  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded()) return;
    (instance.getSource(GEOGRAPHIC_SOURCE_IDS.zones) as GeoJSONSource | undefined)?.setData(model.zones);
    (instance.getSource(GEOGRAPHIC_SOURCE_IDS.placements) as GeoJSONSource | undefined)?.setData(model.placements);
  }, [model]);

  const fallback =
    phase.kind === "failed" ? "map.failed" : phase.kind === "resolved" ? fallbackMessageKey(phase.capability) : null;

  return (
    <div role="region" aria-label={label} className={className}>
      {phase.kind === "loading" ? (
        <p role="status" className="text-sm text-[var(--dpf-muted)]">
          {t("map.loading")}
        </p>
      ) : null}
      {fallback ? (
        <p role="status" className="text-sm text-[var(--dpf-muted)]">
          {t(fallback)}
        </p>
      ) : null}
      <div
        ref={container}
        data-testid="geographic-scene-canvas"
        hidden={fallback !== null}
        className="h-80 w-full overflow-hidden rounded border border-[var(--dpf-border)]"
      />
    </div>
  );
}
