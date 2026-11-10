"use client";

// Administrator controls for the opt-in geocoding backfill (BI-560128FB,
// AC-CMAP-PROVIDER-1/2): choose a provider (None by default) and find missing
// locations, with counts from the last run.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FormStatus, SelectField, TextField } from "@/components/ui/form";
import { Surface } from "@/components/ui/Surface";
import {
  installRecommendedMapPackAction,
  saveGeocodingProviderAction,
  startGeocodingBackfillAction,
} from "@/lib/actions/customer-map";
import type { GeocodingConfig } from "@/lib/geocoding/providers";
import type { GeocodingBackfillStatus } from "@/lib/geocoding/backfill.server";
import type { RegionRecommendation } from "@/lib/twin/map-region-recommendation";
import { IDLE_INSTALL, IN_FLIGHT_STATES, type MapPackInstallStatus } from "@/lib/twin/map-pack-install/status";
import { useBackgroundOperationObserver } from "@/lib/hooks/useBackgroundOperationObserver";
import { useT } from "@/lib/i18n/use-t";

export function GeocodingAdminPanel({
  config,
  opencageKeyConfigured,
  status,
  regions = null,
  install: initialInstall = null,
  installRunning: initialInstallRunning = false,
}: {
  config: GeocodingConfig;
  opencageKeyConfigured: boolean;
  status: GeocodingBackfillStatus;
  /** Street-map regions the placed locations need (BI-C318C227 §2.3). */
  regions?: RegionRecommendation | null;
  /** Progress of a street-map pack install (BI-43BBCC26). */
  install?: MapPackInstallStatus | null;
  /** The server's view of whether that install is still making progress (stalled runs are not). */
  installRunning?: boolean;
}) {
  const t = useT("customerMap");
  const router = useRouter();
  const [provider, setProvider] = useState<string>(config.provider);
  const [url, setUrl] = useState(config.provider === "self-hosted" ? config.url : "");
  const [flavor, setFlavor] = useState(config.provider === "self-hosted" ? config.flavor : "nominatim");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveGeocodingProviderAction({ provider, url, flavor }).catch(() => null);
      setMessage(result?.ok ? { kind: "success", text: t("admin.saved") } : { kind: "error", text: t("placeFailed") });
      router.refresh();
    });
  }

  function installPack(packId: string) {
    startTransition(async () => {
      const result = await installRecommendedMapPackAction(packId).catch(() => null);
      setMessage(
        result?.ok
          ? { kind: "success", text: t("admin.streetMapsInstallStarted") }
          : { kind: "error", text: t(installRefusalKey(result && !result.ok ? result.error : null)) },
      );
      void installObserver.refresh();
    });
  }

  // The install runs in the background. Its status projection is observed per
  // the background-operation observation contract: events invalidate, the
  // projection is re-read, the route is never refreshed on a timer.
  const installObserver = useBackgroundOperationObserver<{ status: MapPackInstallStatus; running: boolean }>({
    endpoint: "/api/map-assets/install-status",
    eventType: "system:map-pack-install",
    initialSnapshot: { status: initialInstall ?? IDLE_INSTALL, running: initialInstallRunning },
    isActive: (snapshot) => snapshot.running,
  });
  const install = installObserver.snapshot.status;
  const installRunning = installObserver.snapshot.running;
  const stalled = install ? IN_FLIGHT_STATES.includes(install.state) && !installRunning : false;

  function start() {
    startTransition(async () => {
      const result = await startGeocodingBackfillAction().catch(() => null);
      setMessage(result?.ok ? { kind: "success", text: t("admin.running") } : { kind: "error", text: t("admin.notStarted") });
      router.refresh();
    });
  }

  return (
    <Surface as="section" className="space-y-3 text-sm text-[var(--dpf-text)]">
      <h3 className="font-semibold">{t("admin.heading")}</h3>
      <p className="max-w-3xl text-[var(--dpf-muted)]">{t("admin.explain")}</p>
      <SelectField
        name="geocoding-provider"
        label={t("admin.provider")}
        value={provider}
        onValueChange={setProvider}
        options={[
          { value: "none", label: t("admin.none") },
          { value: "census", label: t("admin.census") },
          { value: "opencage", label: t("admin.opencage"), disabled: !opencageKeyConfigured },
          { value: "self-hosted", label: t("admin.selfHosted") },
        ]}
        hint={opencageKeyConfigured ? undefined : t("admin.opencageMissing")}
      />
      {provider === "self-hosted" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="geocoding-url" label={t("admin.url")} value={url} onValueChange={setUrl} />
          <SelectField
            name="geocoding-flavor"
            label={t("admin.flavor")}
            value={flavor}
            onValueChange={(value) => setFlavor(value === "photon" ? "photon" : "nominatim")}
            options={[
              { value: "nominatim", label: "Nominatim" },
              { value: "photon", label: "Photon" },
            ]}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={save} disabled={pending}>
          {t("admin.save")}
        </Button>
        <Button onClick={start} disabled={pending || config.provider === "none" || status.state === "running"}>
          {t("admin.start")}
        </Button>
      </div>
      {status.state === "running" ? <p role="status">{t("admin.running")}</p> : null}
      {status.state === "failed" ? <p role="status">{t("admin.failed")}</p> : null}
      {status.state === "done" ? (
        <p role="status" className="text-[var(--dpf-muted)]">
          {t("admin.status", { placed: status.placed, notFound: status.notFound, remaining: status.remaining ?? 0 })}
        </p>
      ) : null}
      <FormStatus
        success={message?.kind === "success" ? message.text : undefined}
        error={message?.kind === "error" ? message.text : undefined}
      />
      {regions ? (
        <div className="space-y-1">
          <h4 className="font-semibold">{t("admin.streetMapsHeading")}</h4>
          {regions.status === "no-locations" ? (
            <p className="text-[var(--dpf-muted)]">{t("admin.streetMapsNone")}</p>
          ) : (
            <ul className="space-y-1">
              {regions.groups.map((group) => (
                <li key={group.label} className={group.coveredBy ? "text-[var(--dpf-muted)]" : undefined}>
                  {group.coveredBy
                    ? t("admin.streetMapsCovered", { region: group.label, pack: group.coveredBy, count: group.pointCount })
                    : group.suggestedPackId
                      ? t("admin.streetMapsMissing", { region: group.label, pack: group.suggestedPackId, count: group.pointCount })
                      : t("admin.streetMapsNoCountry", { region: group.label, count: group.pointCount })}
                  {!group.coveredBy && group.suggestedPackId ? (
                    <div className="mt-1">
                      <Button
                        variant="secondary"
                        onClick={() => installPack(group.suggestedPackId!)}
                        disabled={pending || installRunning}
                      >
                        {t("admin.streetMapsInstall", { region: group.label })}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p role="status" className={install?.state === "done" ? "text-[var(--dpf-muted)]" : undefined}>
            {installLine(install, stalled, t)}
          </p>
        </div>
      ) : null}
    </Surface>
  );
}

/** The refused-install message: the server names why, so the panel says it. */
function installRefusalKey(error: string | null) {
  if (error === "already-running") return "admin.streetMapsInstallRunning" as const;
  if (error === "not-recommended") return "admin.streetMapsInstallNotRecommended" as const;
  return "admin.streetMapsInstallRefused" as const;
}

function installLine(
  install: MapPackInstallStatus | null,
  stalled: boolean,
  t: ReturnType<typeof useT<"customerMap">>,
): string | null {
  if (!install || install.state === "idle" || !install.region) return null;
  const region = install.region;
  if (stalled) return t("admin.streetMapsInstallStalled", { region });
  switch (install.state) {
    case "planning":
      return t("admin.streetMapsInstallPlanning", { region });
    case "downloading":
      return t("admin.streetMapsInstallDownloading", { region, done: install.chunksDone, count: install.chunkCount });
    case "finalizing":
      return t("admin.streetMapsInstallFinalizing", { region });
    case "done":
      return t("admin.streetMapsInstallDone", { region });
    default:
      return install.error
        ? t("admin.streetMapsInstallFailedReason", { region, reason: install.error })
        : t("admin.streetMapsInstallFailed", { region });
  }
}
