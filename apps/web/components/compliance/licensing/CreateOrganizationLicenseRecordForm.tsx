"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "@/components/compliance/ComplianceModal";
import { createOrganizationLicenseRecord } from "@/lib/actions/licensing-compliance";

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";

type RequirementOption = {
  id: string;
  requirementRefId: string;
  jurisdictionLabel: string;
  authorityName: string;
  requirementType: string;
  scopeLevel: string;
};

type Props = {
  requirementOptions: RequirementOption[];
};

export function CreateOrganizationLicenseRecordForm({ requirementOptions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await createOrganizationLicenseRecord({
      requirementReferenceId: (form.get("requirementReferenceId") as string) || "",
      licenseKind: form.get("licenseKind") as string,
      status: form.get("status") as string,
      licenseNumber: (form.get("licenseNumber") as string) || "",
      issuedAt: (form.get("issuedAt") as string) || "",
      effectiveFrom: (form.get("effectiveFrom") as string) || "",
      expiresAt: (form.get("expiresAt") as string) || "",
      renewalCadence: (form.get("renewalCadence") as string) || "",
      renewalFeeAmount: (form.get("renewalFeeAmount") as string) || "",
      renewalFeeCurrency: (form.get("renewalFeeCurrency") as string) || "",
      displayRequirementStatus: form.get("displayRequirementStatus") as string,
      officialSourceUrl: (form.get("officialSourceUrl") as string) || "",
      verificationNotes: (form.get("verificationNotes") as string) || "",
      displayType: (form.get("displayType") as string) || "",
      displayLocation: (form.get("displayLocation") as string) || "",
      displayRequirementLevel: (form.get("displayRequirementLevel") as string) || "",
      feeType: (form.get("feeType") as string) || "",
      feeAmount: (form.get("feeAmount") as string) || "",
      feeCurrency: (form.get("feeCurrency") as string) || "",
      feeDueDate: (form.get("feeDueDate") as string) || "",
      financeHandoffMode: (form.get("financeHandoffMode") as string) || "",
      feeNotes: (form.get("feeNotes") as string) || "",
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        Add company license
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Add Company License">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={labelClasses}>Requirement reference</label>
            <select name="requirementReferenceId" className={inputClasses} defaultValue="">
              <option value="">Manual record</option>
              {requirementOptions
                .filter((option) => option.scopeLevel === "organization" || option.scopeLevel === "activity" || option.scopeLevel === "premises")
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.authorityName} · {option.jurisdictionLabel}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>License kind *</label>
              <input name="licenseKind" required className={inputClasses} placeholder="contractor_license" />
            </div>
            <div>
              <label className={labelClasses}>Status *</label>
              <select name="status" className={inputClasses} defaultValue="active">
                <option value="draft">Draft</option>
                <option value="researching">Researching</option>
                <option value="applied">Applied</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="suspended">Suspended</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>License number</label>
              <input name="licenseNumber" className={inputClasses} placeholder="NV-12345" />
            </div>
            <div>
              <label className={labelClasses}>Display status</label>
              <select name="displayRequirementStatus" className={inputClasses} defaultValue="unknown">
                <option value="unknown">Unknown</option>
                <option value="required">Required</option>
                <option value="not_required">Not required</option>
                <option value="satisfied">Satisfied</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClasses}>Issued</label>
              <input name="issuedAt" type="date" className={inputClasses} />
            </div>
            <div>
              <label className={labelClasses}>Effective</label>
              <input name="effectiveFrom" type="date" className={inputClasses} />
            </div>
            <div>
              <label className={labelClasses}>Expires</label>
              <input name="expiresAt" type="date" className={inputClasses} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Renewal cadence</label>
              <input name="renewalCadence" className={inputClasses} placeholder="annual" />
            </div>
            <div>
              <label className={labelClasses}>Source URL</label>
              <input name="officialSourceUrl" className={inputClasses} placeholder="https://authority.example/license/123" />
            </div>
          </div>

          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Display obligation</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <label className={labelClasses}>Display type</label>
                <input name="displayType" className={inputClasses} placeholder="wall_certificate" />
              </div>
              <div>
                <label className={labelClasses}>Location</label>
                <input name="displayLocation" className={inputClasses} placeholder="front_desk" />
              </div>
              <div>
                <label className={labelClasses}>Requirement level</label>
                <select name="displayRequirementLevel" className={inputClasses} defaultValue="required">
                  <option value="required">Required</option>
                  <option value="recommended">Recommended</option>
                  <option value="marketing_optional">Marketing optional</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Fee tracking</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClasses}>Fee type</label>
                <input name="feeType" className={inputClasses} placeholder="renewal" />
              </div>
              <div>
                <label className={labelClasses}>Finance handoff</label>
                <select name="financeHandoffMode" className={inputClasses} defaultValue="track_only">
                  <option value="track_only">Track only</option>
                  <option value="finance_review">Finance review</option>
                  <option value="external_accounting">External accounting</option>
                </select>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <label className={labelClasses}>Amount</label>
                <input name="feeAmount" className={inputClasses} placeholder="250.00" />
              </div>
              <div>
                <label className={labelClasses}>Currency</label>
                <input name="feeCurrency" className={inputClasses} defaultValue="USD" />
              </div>
              <div>
                <label className={labelClasses}>Due date</label>
                <input name="feeDueDate" type="date" className={inputClasses} />
              </div>
            </div>
            <div className="mt-3">
              <label className={labelClasses}>Fee notes</label>
              <textarea name="feeNotes" rows={2} className={inputClasses} />
            </div>
          </div>

          <div>
            <label className={labelClasses}>Verification notes</label>
            <textarea name="verificationNotes" rows={2} className={inputClasses} />
          </div>

          {error ? <p className="text-xs text-[var(--dpf-error)]">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Saving..." : "Create"}
            </button>
          </div>
        </form>
      </ComplianceModal>
    </>
  );
}
