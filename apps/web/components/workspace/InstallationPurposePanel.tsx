"use client";

import { CheckCircle2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  type InstallationOperatingPurpose,
} from "@dpf/db/installation-operating-intent";
import { confirmInstallationOperatingPurpose } from "@/lib/actions/installation-operating-intent";
import type { LoadedInstallationOperatingIntent } from "@/lib/installation-journey/operating-intent";

const PURPOSE_OPTIONS: Array<{
  value: InstallationOperatingPurpose;
  label: string;
}> = [
  { value: "operate-organization", label: "Run our organization" },
  { value: "evolve-dpf", label: "Safely improve another DPF" },
  { value: "deliver-managed-services", label: "Operate DPF for customers" },
  { value: "grow-channel", label: "Grow DPF in a market or region" },
  { value: "participate-community", label: "Participate in the DPF community" },
];

export function InstallationPurposePanel({
  loaded,
}: {
  loaded: LoadedInstallationOperatingIntent;
}) {
  const router = useRouter();
  const current = loaded.status === "valid" ? loaded.intent.primaryPurpose : null;
  const confirmed = loaded.status === "valid" && loaded.intent.confirmation.status === "confirmed";
  const [purpose, setPurpose] = useState<InstallationOperatingPurpose>(current ?? "operate-organization");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const consequence = purpose === "operate-organization"
    ? "This installation may make governed funding decisions after the organization stance approves them."
    : "This installation may contribute demand and evidence, while canonical funding stays with the organization-operating installation.";

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await confirmInstallationOperatingPurpose(purpose);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage("Operating purpose confirmed.");
      router.refresh();
    });
  }

  return (
    <section className="border-b border-[var(--dpf-border)] px-4 py-4 sm:px-6" aria-labelledby="installation-purpose-heading">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 id="installation-purpose-heading" className="text-base font-semibold text-[var(--dpf-text)]">Installation purpose</h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Choose which outcome this installation is accountable for first.
          </p>
        </div>
        {confirmed && current ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--dpf-success)]">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
            Confirmed
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-xs font-medium text-[var(--dpf-muted)]">
          Primary operating purpose
          <select
            value={purpose}
            onChange={(event) => setPurpose(event.target.value as InstallationOperatingPurpose)}
            disabled={isPending}
            className="mt-1 min-h-10 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            {PURPOSE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={save}
          disabled={isPending || (confirmed && purpose === current)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[var(--dpf-accent)] px-4 text-sm font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {isPending ? "Confirming" : "Confirm purpose"}
        </button>
      </div>

      <p className="mt-2 text-xs text-[var(--dpf-muted)]">{consequence}</p>

      {message ? <p className="mt-2 text-xs text-[var(--dpf-muted)]" role="status">{message}</p> : null}
      {loaded.status === "invalid" ? (
        <p className="mt-2 text-xs text-[var(--dpf-danger)]" role="alert">
          The stored operating-purpose record needs to be confirmed again.
        </p>
      ) : null}
    </section>
  );
}
