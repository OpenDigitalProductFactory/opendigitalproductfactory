"use client";

// One switch: share this installation's country with the organizations it
// federates under, so their market map can count it (BI-06EA3167). Off by
// default; turning it off withdraws what was shared.

import { useState, useTransition } from "react";

import { CheckboxField, FormStatus } from "@/components/ui/form";
import { Surface } from "@/components/ui/Surface";
import { setDeploymentCountrySharingAction } from "@/lib/actions/deployment-country-sharing";
import { useT } from "@/lib/i18n/use-t";

export function DeploymentCountrySharingPanel({
  enabled,
  countryCode,
  countryName,
  recipients,
}: {
  enabled: boolean;
  countryCode: string | null;
  countryName: string | null;
  recipients: string[];
}) {
  const t = useT("deploymentSharing");
  const [checked, setChecked] = useState(enabled);
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    const previous = checked;
    setChecked(next);
    setStatus("idle");
    startTransition(async () => {
      const result = await setDeploymentCountrySharingAction(next).catch(() => null);
      if (result?.ok) {
        setStatus("saved");
      } else {
        setChecked(previous);
        setStatus("failed");
      }
    });
  }

  const country = countryName ?? countryCode;
  return (
    <Surface as="section" className="space-y-2 text-sm text-[var(--dpf-text)]">
      <h2 className="font-semibold">{t("heading")}</h2>
      <p className="max-w-3xl text-[var(--dpf-muted)]">{t("explain")}</p>
      <CheckboxField
        name="share-deployment-country"
        label={country ? t("toggle", { country }) : t("toggleNoCountry")}
        checked={checked}
        onCheckedChange={change}
        disabled={pending || (!countryCode && !checked)}
        hint={countryCode ? undefined : t("noCountry")}
      />
      <p className="text-[var(--dpf-muted)]">
        {recipients.length > 0 ? t("recipients", { names: recipients.join(", ") }) : t("noRecipients")}
      </p>
      <FormStatus success={status === "saved" ? t("saved") : undefined} error={status === "failed" ? t("failed") : undefined} />
    </Surface>
  );
}
