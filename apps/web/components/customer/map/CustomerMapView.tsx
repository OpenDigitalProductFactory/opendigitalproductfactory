"use client";

// The customer map view (BI-560128FB): customer sites on the map, and the
// sites that are not on it, each with a way to fix it. The account list on the
// same page stays the accessible equivalent. Service areas (BI-6CC10E4C) are
// drawn on the same map and their coverage is listed under it.

import Link from "next/link";
import { useMemo, useReducer, useState, useTransition } from "react";

import type { GeographicSceneLayout } from "@dpf/storefront-templates";
import { useRouter } from "next/navigation";

import { GeographicSceneCanvas } from "@/components/twin/geographic/GeographicSceneCanvas";
import { Button } from "@/components/ui/Button";
import { FormStatus } from "@/components/ui/form";
import { Surface } from "@/components/ui/Surface";
import { placeCustomerSiteOnMapAction } from "@/lib/actions/customer-map";
import type { CustomerMap } from "@/lib/crm/customer-map";
import { useT } from "@/lib/i18n/use-t";
import { buildGeographicSceneModel } from "@/lib/twin/geographic-scene";

import { closedRing, drawingReducer, IDLE } from "./service-area-drawing";
import { ServiceAreasPanel } from "./ServiceAreasPanel";

const NO_CORNERS: readonly { latitude: number; longitude: number }[] = [];
const EMPTY_LAYOUT: GeographicSceneLayout = {
  schemaVersion: 1,
  spaceKind: "geographic",
  viewport: { latitude: 20, longitude: 0, zoom: 1 },
  zones: [],
  placements: [],
};

export function CustomerMapView({ map, canEdit }: { map: CustomerMap; canEdit: boolean }) {
  const t = useT("customerMap");
  const router = useRouter();
  const [placing, setPlacing] = useState<{ siteId: string; label: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "placed" | "failed">("idle");
  const [pending, startTransition] = useTransition();
  const [drawing, dispatch] = useReducer(drawingReducer, IDLE);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // With nothing placed yet, a pin still needs a map to click on: centre on 0,0.
  const layout = map.layout ?? EMPTY_LAYOUT;
  const draftLabel = t("areas.add");
  const corners = drawing.mode === "idle" ? NO_CORNERS : drawing.points;
  const model = useMemo(() => {
    const draftRing = closedRing(corners);
    const scene = {
      ...layout,
      zones: draftRing
        ? [...layout.zones, { id: "draft-area", label: draftLabel, geometry: { kind: "polygon" as const, rings: [draftRing] } }]
        : layout.zones,
      placements: [
        ...layout.placements,
        ...corners.map((point, index) => ({
          id: `draft-corner:${index}`,
          entityRef: { kind: "draft-corner", id: `draft-corner:${index}` },
          label: String(index + 1),
          geometry: { kind: "point" as const, latitude: point.latitude, longitude: point.longitude },
        })),
      ],
    };
    return scene.placements.length > 0 || scene.zones.length > 0
      ? buildGeographicSceneModel({
          layout: scene,
          presentations: map.presentations,
          selectedEntityIds: selectedSiteId ? [selectedSiteId] : [],
        })
      : null;
  }, [layout, map.presentations, corners, selectedSiteId, draftLabel]);

  const drawingActive = drawing.mode === "drawing";
  const onMapPoint = placing && !pending ? place : drawingActive ? (latitude: number, longitude: number) => dispatch({ type: "add", point: { latitude, longitude } }) : null;

  function place(latitude: number, longitude: number) {
    if (!placing) return;
    const target = placing;
    startTransition(async () => {
      const result = await placeCustomerSiteOnMapAction(target.siteId, latitude, longitude).catch(() => null);
      setStatus(result?.ok ? "placed" : "failed");
      setPlacing(null);
      if (result?.ok) router.refresh();
    });
  }

  const missing = map.unplaced.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--dpf-muted)]">{t("summary", { placed: map.placedCount, missing })}</p>
      {model || placing || drawing.mode !== "idle" ? (
        <GeographicSceneCanvas
          model={
            model ?? {
              viewport: layout.viewport,
              bounds: { west: -170, south: -60, east: 170, north: 75, crossesAntimeridian: false },
              zones: { type: "FeatureCollection", features: [] },
              placements: { type: "FeatureCollection", features: [] },
            }
          }
          label={t("mapLabel")}
          onPlacePoint={onMapPoint}
          onSelectEntity={(entityId) => setSelectedSiteId(entityId && map.presentations[entityId] ? entityId : null)}
        />
      ) : (
        <p className="text-sm text-[var(--dpf-text)]">{t("empty")}</p>
      )}
      {placing ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--dpf-text)]" role="status">
          <span>{t("placing", { site: placing.label })}</span>
          <Button variant="ghost" size="sm" onClick={() => setPlacing(null)}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}
      <FormStatus success={status === "placed" ? t("placed") : undefined} error={status === "failed" ? t("placeFailed") : undefined} />

      <ServiceAreasPanel
        coverage={map.coverage}
        presentations={map.presentations}
        canEdit={canEdit && !placing}
        drawing={drawing}
        dispatch={dispatch}
        selectedSiteId={selectedSiteId}
      />

      {missing > 0 ? (
        <Surface as="section" className="space-y-2 text-sm">
          <h3 className="font-semibold text-[var(--dpf-text)]">{t("notOnMap", { count: missing })}</h3>
          <ul className="divide-y divide-[var(--dpf-border)]">
            {map.unplaced.map((site) => (
              <li key={site.siteId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--dpf-text)]">
                    {site.accountName} · {site.siteName}
                  </p>
                  <p className="text-[var(--dpf-muted)]">
                    {site.reason === "no-address" ? t("reasonNoAddress") : `${t("reasonNoCoordinates")}: ${site.addressLabel ?? ""}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/customer/${site.accountId}`}
                    className="inline-flex min-h-[44px] items-center text-[var(--dpf-accent)] underline"
                  >
                    {t("checkAddress")}
                  </Link>
                  {canEdit && site.reason === "no-coordinates" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => setPlacing({ siteId: site.siteId, label: `${site.accountName} · ${site.siteName}` })}
                    >
                      {t("place")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}
    </div>
  );
}
