"use client";

// Administrator controls for the opt-in geocoding backfill (BI-560128FB,
// AC-CMAP-PROVIDER-1/2): choose a provider (None by default) and find missing
// locations, with counts from the last run.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FormStatus, SelectField, TextField } from "@/components/ui/form";
import { Surface } from "@/components/ui/Surface";
import { saveGeocodingProviderAction, startGeocodingBackfillAction } from "@/lib/actions/customer-map";
import type { GeocodingConfig } from "@/lib/geocoding/providers";
import type { GeocodingBackfillStatus } from "@/lib/geocoding/backfill.server";
import { useT } from "@/lib/i18n/use-t";

export function GeocodingAdminPanel({
  config,
  opencageKeyConfigured,
  status,
}: {
  config: GeocodingConfig;
  opencageKeyConfigured: boolean;
  status: GeocodingBackfillStatus;
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
    </Surface>
  );
}
