"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTaxAuthorityCredential } from "@/lib/actions/tax-remittance";
import type { SaveTaxAuthorityCredentialInput } from "@/lib/finance/tax-remittance-validation";

const inputClasses =
  "rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none";

type RegistrationRecord = {
  id: string;
  registrationId: string;
  registrationStatus: string;
  jurisdictionReference: {
    authorityName: string;
    countryCode: string;
    stateProvinceCode: string | null;
  };
};

type CredentialRecord = {
  id: string;
  credentialId: string;
  registrationId: string;
  authorityName: string;
  portalBaseUrl: string | null;
  credentialOwnerMode: string;
  status: string;
  authMode: string;
  mfaMode: string;
  hasSecret: boolean;
  lastVerifiedAt: Date | string | null;
  lastFailureAt: Date | string | null;
  lastFailureReason: string | null;
  notes: string | null;
};

type Props = {
  registrations: RegistrationRecord[];
  authorityCredentials: CredentialRecord[];
};

function buildFormState(
  registrations: RegistrationRecord[],
  authorityCredentials: CredentialRecord[],
): Record<string, SaveTaxAuthorityCredentialInput> {
  const credentialMap = new Map(authorityCredentials.map((credential) => [credential.registrationId, credential]));

  return Object.fromEntries(
    registrations.map((registration) => {
      const credential = credentialMap.get(registration.id);
      return [
        registration.id,
        {
          registrationId: registration.id,
          portalBaseUrl: credential?.portalBaseUrl ?? "",
          credentialOwnerMode: (credential?.credentialOwnerMode ?? "business_shared") as SaveTaxAuthorityCredentialInput["credentialOwnerMode"],
          status: (credential?.status ?? "draft") as SaveTaxAuthorityCredentialInput["status"],
          authMode: (credential?.authMode ?? "portal_username_password") as SaveTaxAuthorityCredentialInput["authMode"],
          secretRef: "",
          mfaMode: (credential?.mfaMode ?? "human_step_up") as SaveTaxAuthorityCredentialInput["mfaMode"],
          notes: credential?.notes ?? "",
        },
      ];
    }),
  );
}

export function TaxAuthorityCredentialPanel({ registrations, authorityCredentials }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedRegistrationId, setSavedRegistrationId] = useState<string | null>(null);
  const credentialMap = useMemo(
    () => new Map(authorityCredentials.map((credential) => [credential.registrationId, credential])),
    [authorityCredentials],
  );
  const [forms, setForms] = useState<Record<string, SaveTaxAuthorityCredentialInput>>(
    buildFormState(registrations, authorityCredentials),
  );

  useEffect(() => {
    setForms(buildFormState(registrations, authorityCredentials));
  }, [registrations, authorityCredentials]);

  function updateField<K extends keyof SaveTaxAuthorityCredentialInput>(
    registrationId: string,
    key: K,
    value: SaveTaxAuthorityCredentialInput[K],
  ) {
    setForms((current) => ({
      ...current,
      [registrationId]: {
        ...(current[registrationId] ?? buildFormState(registrations, authorityCredentials)[registrationId]!),
        [key]: value,
      },
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>, registrationId: string) {
    event.preventDefault();
    setError(null);
    setSavedRegistrationId(null);

    startTransition(async () => {
      try {
        await saveTaxAuthorityCredential(forms[registrationId]!);
        setSavedRegistrationId(registrationId);
        router.refresh();
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : "Unable to save authority credential.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Authority Credential Custody
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Record whether DPF can execute filings for a given authority, how credentials are held, and whether step-up authentication still blocks automation.
          </p>
        </div>
        <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
          {authorityCredentials.filter((credential) => credential.status === "active").length} active
        </span>
      </div>

      {error ? <p className="mt-4 text-xs text-[var(--dpf-danger)]">{error}</p> : null}

      <div className="mt-4 space-y-4">
        {registrations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
            Add a registration first so execution custody can be configured per authority.
          </div>
        ) : (
          registrations.map((registration) => {
            const credential = credentialMap.get(registration.id);
            const form = forms[registration.id];

            if (!form) return null;

            return (
              <form
                key={registration.id}
                onSubmit={(event) => handleSubmit(event, registration.id)}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">
                      {registration.jurisdictionReference.authorityName}
                    </p>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      {registration.registrationId} · {registration.registrationStatus}
                    </p>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      {credential?.hasSecret ? "Encrypted secret stored in this install." : "No stored secret recorded yet."}
                    </p>
                    {credential?.lastFailureReason ? (
                      <p className="mt-1 text-xs text-[var(--dpf-danger)]">{credential.lastFailureReason}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                      {credential?.status ?? "draft"}
                    </span>
                    <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                      {credential?.authMode ?? "portal_username_password"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <label className="text-xs text-[var(--dpf-muted)]">
                    Portal URL
                    <input
                      value={form.portalBaseUrl ?? ""}
                      onChange={(event) => updateField(registration.id, "portalBaseUrl", event.target.value)}
                      className={`mt-1 w-full ${inputClasses}`}
                      placeholder="https://authority.example.gov"
                    />
                  </label>

                  <label className="text-xs text-[var(--dpf-muted)]">
                    Custody mode
                    <select
                      value={form.credentialOwnerMode}
                      onChange={(event) => updateField(registration.id, "credentialOwnerMode", event.target.value as SaveTaxAuthorityCredentialInput["credentialOwnerMode"])}
                      className={`mt-1 w-full ${inputClasses}`}
                    >
                      <option value="business_shared" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Business shared</option>
                      <option value="dpf_managed" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">DPF managed</option>
                      <option value="accountant_managed" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Accountant managed</option>
                      <option value="partner_managed" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Partner managed</option>
                    </select>
                  </label>

                  <label className="text-xs text-[var(--dpf-muted)]">
                    Credential status
                    <select
                      value={form.status}
                      onChange={(event) => updateField(registration.id, "status", event.target.value as SaveTaxAuthorityCredentialInput["status"])}
                      className={`mt-1 w-full ${inputClasses}`}
                    >
                      <option value="draft" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Draft</option>
                      <option value="active" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Active</option>
                      <option value="blocked" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Blocked</option>
                      <option value="revoked" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Revoked</option>
                    </select>
                  </label>

                  <label className="text-xs text-[var(--dpf-muted)]">
                    Auth mode
                    <select
                      value={form.authMode}
                      onChange={(event) => updateField(registration.id, "authMode", event.target.value as SaveTaxAuthorityCredentialInput["authMode"])}
                      className={`mt-1 w-full ${inputClasses}`}
                    >
                      <option value="portal_username_password" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Portal username / password</option>
                      <option value="api_key" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">API key</option>
                      <option value="oauth" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">OAuth</option>
                      <option value="delegated_partner" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Delegated partner</option>
                    </select>
                  </label>

                  <label className="text-xs text-[var(--dpf-muted)]">
                    MFA mode
                    <select
                      value={form.mfaMode}
                      onChange={(event) => updateField(registration.id, "mfaMode", event.target.value as SaveTaxAuthorityCredentialInput["mfaMode"])}
                      className={`mt-1 w-full ${inputClasses}`}
                    >
                      <option value="human_step_up" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Employee step-up</option>
                      <option value="totp_shared" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Shared TOTP</option>
                      <option value="email_code" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Email code</option>
                      <option value="sms_code" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">SMS code</option>
                    </select>
                  </label>

                  <label className="text-xs text-[var(--dpf-muted)]">
                    Secret or token
                    <input
                      type="password"
                      value={form.secretRef ?? ""}
                      onChange={(event) => updateField(registration.id, "secretRef", event.target.value)}
                      className={`mt-1 w-full ${inputClasses}`}
                      placeholder={credential?.hasSecret ? "Leave blank to keep stored secret" : "Enter portal secret or token"}
                    />
                  </label>

                  <label className="text-xs text-[var(--dpf-muted)] md:col-span-2 xl:col-span-3">
                    Operational notes
                    <textarea
                      value={form.notes ?? ""}
                      onChange={(event) => updateField(registration.id, "notes", event.target.value)}
                      className={`mt-1 min-h-24 w-full ${inputClasses}`}
                      placeholder="Portal quirks, step-up requirements, or execution ownership notes."
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    disabled={isPending}
                  >
                    {isPending ? "Saving..." : "Save custody"}
                  </button>
                  {savedRegistrationId === registration.id && !isPending ? (
                    <span className="text-xs text-[var(--dpf-muted)]">Saved.</span>
                  ) : null}
                  {credential?.lastVerifiedAt ? (
                    <span className="text-xs text-[var(--dpf-muted)]">
                      Last verified {new Date(credential.lastVerifiedAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
              </form>
            );
          })
        )}
      </div>
    </div>
  );
}
