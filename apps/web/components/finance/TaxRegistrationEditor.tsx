"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaxRegistration, verifyTaxRegistration } from "@/lib/actions/tax-remittance";
import type {
  CreateTaxRegistrationInput,
  VerifyTaxRegistrationInput,
} from "@/lib/finance/tax-remittance-validation";

const inputClasses =
  "rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none";

type JurisdictionOption = {
  id: string;
  jurisdictionRefId: string;
  authorityName: string;
  countryCode: string;
  stateProvinceCode: string | null;
  authorityType: string;
  taxTypes: string[];
};

type RegistrationRecord = {
  id: string;
  registrationId: string;
  taxType: string;
  registrationNumber: string | null;
  registrationStatus: string;
  filingFrequency: string;
  filingBasis: string | null;
  remitterRole: string;
  effectiveFrom: Date | string;
  portalAccountNotes: string | null;
  verifiedFromSourceUrl: string | null;
  lastVerifiedAt: Date | string | null;
  confidence: string;
  jurisdictionReference: {
    authorityName: string;
    jurisdictionRefId: string;
    countryCode: string;
    stateProvinceCode: string | null;
  };
};

type TaxIssueRecord = {
  id: string;
  issueType: string;
  severity: string;
  status: string;
  title: string;
  registrationId: string | null;
};

type Props = {
  jurisdictionOptions: JurisdictionOption[];
  registrations: RegistrationRecord[];
  issues: TaxIssueRecord[];
};

const defaultForm: CreateTaxRegistrationInput = {
  jurisdictionReferenceId: "",
  taxType: "sales_tax",
  registrationStatus: "active",
  registrationNumber: "",
  filingFrequency: "quarterly",
  filingBasis: "accrual",
  remitterRole: "business",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  portalAccountNotes: "",
};

type VerificationFormState = Record<string, VerifyTaxRegistrationInput>;

export function TaxRegistrationEditor({ jurisdictionOptions, registrations, issues }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<CreateTaxRegistrationInput>(defaultForm);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [verificationForms, setVerificationForms] = useState<VerificationFormState>(() =>
    Object.fromEntries(
      registrations.map((registration) => [
        registration.id,
        {
          registrationId: registration.id,
          verifiedFromSourceUrl: registration.verifiedFromSourceUrl ?? "",
          portalAccountNotes: registration.portalAccountNotes ?? "",
          confidence: "high",
        },
      ]),
    ),
  );

  const issuesByRegistration = useMemo(() => {
    const map = new Map<string, TaxIssueRecord[]>();
    for (const issue of issues) {
      if (!issue.registrationId || issue.status !== "open") continue;
      const current = map.get(issue.registrationId) ?? [];
      current.push(issue);
      map.set(issue.registrationId, current);
    }
    return map;
  }, [issues]);

  function labelForJurisdiction(option: JurisdictionOption) {
    const region = option.stateProvinceCode ? ` ${option.stateProvinceCode}` : "";
    return `${option.authorityName} (${option.countryCode}${region})`;
  }

  function updateField<K extends keyof CreateTaxRegistrationInput>(
    key: K,
    value: CreateTaxRegistrationInput[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateVerificationField(
    registrationId: string,
    key: keyof VerifyTaxRegistrationInput,
    value: string,
  ) {
    setVerificationForms((current) => ({
      ...current,
      [registrationId]: {
        ...(current[registrationId] ?? {
          registrationId,
          verifiedFromSourceUrl: "",
          portalAccountNotes: "",
          confidence: "high",
        }),
        [key]: value,
      },
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      try {
        await createTaxRegistration(form);
        setSaved(true);
        setForm(defaultForm);
        router.refresh();
      } catch (submissionError) {
        setError(
          submissionError instanceof Error ? submissionError.message : "Unable to save registration.",
        );
      }
    });
  }

  function handleVerificationSubmit(
    event: React.FormEvent<HTMLFormElement>,
    registrationId: string,
  ) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        await verifyTaxRegistration(verificationForms[registrationId] ?? {
          registrationId,
          verifiedFromSourceUrl: "",
          portalAccountNotes: "",
          confidence: "high",
        });
        router.refresh();
      } catch (submissionError) {
        setError(
          submissionError instanceof Error ? submissionError.message : "Unable to verify registration.",
        );
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
              Registrations
            </p>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              Add the authorities this business files with today or believes it should file with next.
            </p>
          </div>
          <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
            {registrations.length} total
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {registrations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
              No authority registrations have been recorded yet.
            </div>
          ) : (
            registrations.map((registration) => {
              const registrationIssues = issuesByRegistration.get(registration.id) ?? [];
              const verificationState = verificationForms[registration.id] ?? {
                registrationId: registration.id,
                verifiedFromSourceUrl: registration.verifiedFromSourceUrl ?? "",
                portalAccountNotes: registration.portalAccountNotes ?? "",
                confidence: "high",
              };

              return (
                <div
                  key={registration.id}
                  className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--dpf-text)]">
                        {registration.jurisdictionReference.authorityName}
                      </p>
                      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                        {registration.taxType} · {registration.filingFrequency}
                        {registration.registrationNumber ? ` · ${registration.registrationNumber}` : " · registration number pending"}
                      </p>
                      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                        {registration.lastVerifiedAt
                          ? `Live verified ${new Date(registration.lastVerifiedAt).toLocaleDateString()}`
                          : "Live verification still needed"}
                      </p>
                      {registration.verifiedFromSourceUrl && (
                        <a
                          href={registration.verifiedFromSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs text-[var(--dpf-accent)] hover:underline"
                        >
                          Open recorded source
                        </a>
                      )}
                    </div>
                    <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                      {registration.registrationStatus}
                    </span>
                  </div>

                  {registrationIssues.length > 0 && (
                    <div className="mt-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                        Open gaps
                      </p>
                      <div className="mt-2 space-y-2">
                        {registrationIssues.map((issue) => (
                          <div key={issue.id} className="text-xs text-[var(--dpf-text)]">
                            <span className="font-medium">{issue.title}</span>
                            <span className="ml-2 text-[var(--dpf-muted)]">{issue.severity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <form
                    onSubmit={(event) => handleVerificationSubmit(event, registration.id)}
                    className="mt-3 grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]"
                  >
                    <label className="text-xs text-[var(--dpf-muted)]">
                      Official source URL
                      <input
                        value={verificationState.verifiedFromSourceUrl}
                        onChange={(event) =>
                          updateVerificationField(registration.id, "verifiedFromSourceUrl", event.target.value)
                        }
                        className={`mt-1 w-full ${inputClasses}`}
                        placeholder="https://..."
                        required
                      />
                    </label>

                    <label className="text-xs text-[var(--dpf-muted)]">
                      Verification notes
                      <input
                        value={verificationState.portalAccountNotes ?? ""}
                        onChange={(event) =>
                          updateVerificationField(registration.id, "portalAccountNotes", event.target.value)
                        }
                        className={`mt-1 w-full ${inputClasses}`}
                        placeholder="Portal confirmed, cadence confirmed, accountant owner..."
                      />
                    </label>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="w-full rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                        disabled={isPending}
                      >
                        {isPending ? "Saving..." : registration.lastVerifiedAt ? "Refresh verification" : "Mark live verified"}
                      </button>
                    </div>
                  </form>
                </div>
              );
            })
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      >
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
          Add Registration
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs text-[var(--dpf-muted)]">
            Jurisdiction
            <select
              value={form.jurisdictionReferenceId}
              onChange={(event) => updateField("jurisdictionReferenceId", event.target.value)}
              className={`mt-1 w-full ${inputClasses}`}
              required
            >
              <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                Select an authority
              </option>
              {jurisdictionOptions.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                >
                  {labelForJurisdiction(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Tax type
            <select
              value={form.taxType}
              onChange={(event) => updateField("taxType", event.target.value as CreateTaxRegistrationInput["taxType"])}
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="sales_tax" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Sales tax</option>
              <option value="vat" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">VAT</option>
              <option value="gst" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">GST</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Registration number
            <input
              value={form.registrationNumber ?? ""}
              onChange={(event) => updateField("registrationNumber", event.target.value)}
              className={`mt-1 w-full ${inputClasses}`}
              placeholder="Optional"
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Status
            <select
              value={form.registrationStatus}
              onChange={(event) =>
                updateField("registrationStatus", event.target.value as CreateTaxRegistrationInput["registrationStatus"])
              }
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="active" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Active</option>
              <option value="pending" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Pending</option>
              <option value="draft" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Draft</option>
              <option value="inactive" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Inactive</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Filing frequency
            <select
              value={form.filingFrequency}
              onChange={(event) =>
                updateField("filingFrequency", event.target.value as CreateTaxRegistrationInput["filingFrequency"])
              }
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="monthly" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Monthly</option>
              <option value="quarterly" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Quarterly</option>
              <option value="annual" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Annual</option>
              <option value="bi_monthly" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Bi-monthly</option>
              <option value="half_yearly" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Half-yearly</option>
              <option value="custom" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Custom</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Effective from
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(event) => updateField("effectiveFrom", event.target.value)}
              className={`mt-1 w-full ${inputClasses}`}
              required
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)] md:col-span-2">
            Portal or owner notes
            <textarea
              value={form.portalAccountNotes ?? ""}
              onChange={(event) => updateField("portalAccountNotes", event.target.value)}
              className={`mt-1 min-h-24 w-full ${inputClasses}`}
              placeholder="Optional notes for coworker follow-up, accountant ownership, or portal access."
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Add registration"}
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
  );
}
