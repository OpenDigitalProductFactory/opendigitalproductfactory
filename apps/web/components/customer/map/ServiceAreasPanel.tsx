"use client";

// Service areas on the customer map (BI-6CC10E4C): draw, name, assign, rename,
// reassign and delete areas, and read the coverage they give: sites outside
// every area, overlaps, and who covers a selected site. Editing controls are
// shown only with operate_customer; the save action checks it again.

import Link from "next/link";
import { useState, useTransition, type Dispatch } from "react";
import { useRouter } from "next/navigation";

import type { GeographicSceneZone, GeographicZoneCoverage } from "@dpf/storefront-templates";

import { Button } from "@/components/ui/Button";
import { FormStatus, SelectField, TextField } from "@/components/ui/form";
import { Surface } from "@/components/ui/Surface";
import { saveServiceAreasAction } from "@/lib/actions/service-areas";
import type { CustomerMapCoverage } from "@/lib/crm/customer-map";
import type { GeographicScenePresentationMap } from "@/lib/twin/geographic-scene";
import { useT } from "@/lib/i18n/use-t";

import { canFinish, newServiceAreaZone, type DrawingAction, type DrawingState } from "./service-area-drawing";

const NOBODY = "";

function assigneeValue(ref: GeographicZoneCoverage | null | undefined): string {
  return ref ? `${ref.kind}:${ref.id}` : NOBODY;
}

function parseAssignee(value: string): GeographicZoneCoverage | null {
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":");
  return (kind === "staffing-crew" || kind === "employee") && id ? { kind, id } : null;
}

function withCoverage(zone: GeographicSceneZone, label: string, coveredBy: GeographicZoneCoverage | null): GeographicSceneZone {
  const { coveredBy: _previous, ...rest } = zone;
  return { ...rest, label: label.trim(), ...(coveredBy ? { coveredBy } : {}) };
}

export function ServiceAreasPanel({
  coverage,
  presentations,
  canEdit,
  drawing,
  dispatch,
  selectedSiteId,
}: {
  coverage: CustomerMapCoverage;
  presentations: GeographicScenePresentationMap;
  canEdit: boolean;
  drawing: DrawingState;
  dispatch: Dispatch<DrawingAction>;
  selectedSiteId: string | null;
}) {
  const t = useT("customerMap");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [assignee, setAssignee] = useState(NOBODY);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const assigneeOptions = [
    { value: NOBODY, label: t("areas.nobody") },
    ...coverage.assignees.map((item) => ({ value: `${item.kind}:${item.id}`, label: item.label })),
  ];
  const areaName = (zoneId: string) => coverage.zones.find((zone) => zone.id === zoneId)?.label ?? zoneId;
  const siteName = (siteId: string) => {
    const presentation = presentations[siteId];
    return presentation ? `${presentation.label} · ${presentation.sublabel}` : siteId;
  };

  function save(zones: GeographicSceneZone[], done: string) {
    startTransition(async () => {
      const result = await saveServiceAreasAction(coverage.version, zones).catch(() => null);
      if (result?.ok) {
        setMessage({ kind: "success", text: done });
        setEditing(null);
        setConfirmDelete(null);
        dispatch({ type: "cancel" });
        setName("");
        setAssignee(NOBODY);
        router.refresh();
        return;
      }
      setMessage({ kind: "error", text: t(result && !result.ok && result.error === "stale" ? "areas.stale" : "areas.saveFailed") });
    });
  }

  function saveNew() {
    if (drawing.mode !== "naming") return;
    const zone = newServiceAreaZone({
      id: `area-${Date.now().toString(36)}`,
      label: name,
      points: drawing.points,
      coveredBy: parseAssignee(assignee),
    });
    if (zone) save([...coverage.zones, zone], t("areas.saved"));
  }

  const selectedZones = selectedSiteId ? (coverage.bySite[selectedSiteId] ?? null) : null;

  return (
    <div className="space-y-3">
      {canEdit && drawing.mode === "idle" ? (
        <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => dispatch({ type: "start" })}>
          {t("areas.add")}
        </Button>
      ) : null}

      {drawing.mode === "drawing" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--dpf-text)]" role="status">
          <span>{t("areas.drawing", { count: drawing.points.length })}</span>
          <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "undo" })} disabled={drawing.points.length === 0}>
            {t("areas.undo")}
          </Button>
          <Button size="sm" onClick={() => dispatch({ type: "finish" })} disabled={!canFinish(drawing)}>
            {t("areas.finish")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "cancel" })}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}

      {drawing.mode === "naming" ? (
        <Surface as="section" className="space-y-3 text-sm">
          <TextField name="service-area-name" label={t("areas.name")} value={name} onValueChange={setName} />
          <SelectField
            name="service-area-assignee"
            label={t("areas.coveredBy")}
            value={assignee}
            onValueChange={setAssignee}
            options={assigneeOptions}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveNew} disabled={pending || !name.trim()}>
              {t("areas.save")}
            </Button>
            <Button variant="ghost" onClick={() => dispatch({ type: "cancel" })}>
              {t("cancel")}
            </Button>
          </div>
        </Surface>
      ) : null}

      <FormStatus
        success={message?.kind === "success" ? message.text : undefined}
        error={message?.kind === "error" ? message.text : undefined}
      />

      {coverage.zones.length > 0 ? (
        <Surface as="section" className="space-y-3 text-sm text-[var(--dpf-text)]">
          <h3 className="font-semibold">{t("areas.heading")}</h3>

          {selectedSiteId && selectedZones ? (
            <p role="status">
              {selectedZones.length === 0
                ? t("areas.selectedOutside", { site: siteName(selectedSiteId) })
                : t("areas.selectedIn", {
                    site: siteName(selectedSiteId),
                    areas: selectedZones
                      .map((zoneId) => {
                        const area = coverage.areas.find((item) => item.zoneId === zoneId);
                        return area?.coveredByLabel ? `${area.label} (${area.coveredByLabel})` : areaName(zoneId);
                      })
                      .join(", "),
                  })}
            </p>
          ) : null}

          <div>
            <h4 className="font-medium">{t("areas.outside", { count: coverage.outside.length })}</h4>
            {coverage.outside.length === 0 ? (
              <p className="text-[var(--dpf-muted)]">{t("areas.allCovered")}</p>
            ) : (
              <ul className="divide-y divide-[var(--dpf-border)]">
                {coverage.outside.map((site) => (
                  <li key={site.siteId} className="py-2">
                    <Link
                      href={`/customer/${site.accountId}`}
                      className="inline-flex min-h-[44px] items-center text-[var(--dpf-accent)] underline"
                    >
                      {site.accountName} · {site.siteName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {coverage.overlaps.length > 0 ? (
            <div>
              <h4 className="font-medium">{t("areas.overlaps", { count: coverage.overlaps.length })}</h4>
              <ul className="divide-y divide-[var(--dpf-border)]">
                {coverage.overlaps.map(({ site, zoneIds }) => (
                  <li key={site.siteId} className="py-2">
                    {site.accountName} · {site.siteName}:{" "}
                    <span className="text-[var(--dpf-muted)]">{zoneIds.map(areaName).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h4 className="font-medium">{t("areas.list")}</h4>
            <ul className="divide-y divide-[var(--dpf-border)]">
              {coverage.areas.map((area) => {
                const zone = coverage.zones.find((item) => item.id === area.zoneId)!;
                return (
                  <li key={area.zoneId} className="space-y-2 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{area.label}</p>
                        <p className="text-[var(--dpf-muted)]">
                          {area.coveredByLabel ? t("areas.coveredByName", { name: area.coveredByLabel }) : t("areas.nobody")} ·{" "}
                          {t("areas.siteCount", { count: area.siteCount })}
                        </p>
                      </div>
                      {canEdit && editing !== area.zoneId ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="min-h-[44px]"
                            onClick={() => {
                              setEditing(area.zoneId);
                              setName(area.label);
                              setAssignee(assigneeValue(area.coveredBy));
                            }}
                          >
                            {t("areas.edit")}
                          </Button>
                          {confirmDelete === area.zoneId ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="min-h-[44px]"
                              disabled={pending}
                              onClick={() => save(coverage.zones.filter((item) => item.id !== area.zoneId), t("areas.deleted"))}
                            >
                              {t("areas.confirmDelete")}
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => setConfirmDelete(area.zoneId)}>
                              {t("areas.delete")}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </div>
                    {canEdit && editing === area.zoneId ? (
                      <div className="space-y-2">
                        <TextField name={`area-name-${area.zoneId}`} label={t("areas.name")} value={name} onValueChange={setName} />
                        <SelectField
                          name={`area-assignee-${area.zoneId}`}
                          label={t("areas.coveredBy")}
                          value={assignee}
                          onValueChange={setAssignee}
                          options={assigneeOptions}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={pending || !name.trim()}
                            onClick={() =>
                              save(
                                coverage.zones.map((item) =>
                                  item.id === area.zoneId ? withCoverage(zone, name, parseAssignee(assignee)) : item,
                                ),
                                t("areas.saved"),
                              )
                            }
                          >
                            {t("areas.save")}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                            {t("cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </Surface>
      ) : null}
    </div>
  );
}
