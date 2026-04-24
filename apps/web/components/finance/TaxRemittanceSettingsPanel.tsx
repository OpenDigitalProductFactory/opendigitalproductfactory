"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOrganizationTaxProfile } from "@/lib/actions/tax-remittance";
import { TaxRegistrationEditor } from "@/components/finance/TaxRegistrationEditor";
import { TaxObligationPeriodsTable } from "@/components/finance/TaxObligationPeriodsTable";
import type { UpdateOrganizationTaxProfileInput } from "@/lib/finance/tax-remittance-validation";

const inputClasses =
  "rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none";

type Workspace = Awaited<ReturnType<typeof import("@/lib/actions/tax-remittance").getTaxRemittanceWorkspace>>;

type Props = {
  workspace: Workspace;
};

export function TaxRemittanceSettingsPanel({ workspace }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<UpdateOrganizationTaxProfileInput>({
    setupMode: workspace.profile.setupMode as UpdateOrganizationTaxProfileInput["setupMode"],
    setupStatus: workspace.profile.setupStatus as UpdateOrganizationTaxProfileInput["setupStatus"],
    homeCountryCode: workspace.profile.homeCountryCode ?? "",
    primaryRegionCode: workspace.profile.primaryRegionCode ?? "",
    taxModel: workspace.profile.taxModel as UpdateOrganizationTaxProfileInput["taxModel"],
    externalSystem: workspace.profile.externalSystem ?? "",
    footprintSummary: workspace.profile.footprintSummary ?? "",
    notes: workspace.profile.notes ?? "",
  });

  function updateField<K extends keyof UpdateOrganizationTaxProfileInput>(
    key: K,
    value: UpdateOrganizationTaxProfileInput[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      try {
        await updateOrganizationTaxProfile(form);
        setSaved(true);
        router.refresh();
      } catch (submissionError) {
        setError(
          submissionError instanceof Error ? submissionError.message : "Unable to save tax profile.",
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
          Tax Posture
        </p>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Capture whether the business is already configured, where it operates, and how the finance coworker should approach remittance setup.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs text-[var(--dpf-muted)]">
            Setup mode
            <select
              value={form.setupMode}
              onChange={(event) => updateField("setupMode", event.target.value as UpdateOrganizationTaxProfileInput["setupMode"])}
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="unknown" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Unknown</option>
              <option value="existing" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Already filing</option>
              <option value="new_business" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">New business</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Setup status
            <select
              value={form.setupStatus}
              onChange={(event) => updateField("setupStatus", event.target.value as UpdateOrganizationTaxProfileInput["setupStatus"])}
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="draft" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Draft</option>
              <option value="in_review" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">In review</option>
              <option value="active" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Active</option>
              <option value="blocked" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Blocked</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Home country
            <input
              value={form.homeCountryCode ?? ""}
              onChange={(event) => updateField("homeCountryCode", event.target.value.toUpperCase())}
              className={`mt-1 w-full ${inputClasses}`}
              placeholder="US"
              maxLength={2}
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Primary region or state
            <input
              value={form.primaryRegionCode ?? ""}
              onChange={(event) => updateField("primaryRegionCode", event.target.value.toUpperCase())}
              className={`mt-1 w-full ${inputClasses}`}
              placeholder="WA"
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Tax model
            <select
              value={form.taxModel}
              onChange={(event) => updateField("taxModel", event.target.value as UpdateOrganizationTaxProfileInput["taxModel"])}
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="simple_manual" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Simple manual</option>
              <option value="externally_calculated" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Externally calculated</option>
              <option value="hybrid" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Hybrid</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            External accounting or tax system
            <input
              value={form.externalSystem ?? ""}
              onChange={(event) => updateField("externalSystem", event.target.value)}
              className={`mt-1 w-full ${inputClasses}`}
              placeholder="QuickBooks, Xero, Avalara, accountant-managed"
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)] md:col-span-2">
            Operating footprint
            <textarea
              value={form.footprintSummary ?? ""}
              onChange={(event) => updateField("footprintSummary", event.target.value)}
              className={`mt-1 min-h-24 w-full ${inputClasses}`}
              placeholder="Where the business is registered, operates, and delivers taxable services."
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)] md:col-span-2">
            Notes
            <textarea
              value={form.notes ?? ""}
              onChange={(event) => updateField("notes", event.target.value)}
              className={`mt-1 min-h-24 w-full ${inputClasses}`}
              placeholder="Known gaps, accountant ownership, or coworker follow-up notes."
            />
          </label>

          <div className="md:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              disabled={isPending}
            >
              {isPending ? "Saving..." : "Save tax posture"}
            </button>
            {saved && !isPending && (
              <span className="text-xs text-[var(--dpf-muted)]">Saved.</span>
            )}
            {error && (
              <span className="text-xs text-[var(--dpf-danger)]">{error}</span>
            )}
          </div>
        </form>
      </div>

      <TaxRegistrationEditor
        jurisdictionOptions={workspace.jurisdictionOptions}
        registrations={workspace.registrations}
      />

      <TaxObligationPeriodsTable periods={workspace.periods} />
    </div>
  );
}
