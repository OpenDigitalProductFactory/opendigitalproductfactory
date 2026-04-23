"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateCustomerConfigurationItem } from "@/lib/actions/crm";

type ItemTypeOption = {
  key: string;
  label: string;
  technologySourceType: "commercial" | "open_source" | "hybrid";
  defaultReviewCadenceDays?: number;
  supportsLicensing?: boolean;
  defaultChargeModel?: string;
};

type ChargeModelOption = {
  key: string;
  label: string;
};

type EditableCustomerConfigurationItem = {
  id: string;
  customerCiId: string;
  name: string;
  siteId?: string | null;
  ciType: string;
  technologySourceType: "commercial" | "open_source" | "hybrid";
  supportModel?: string | null;
  normalizedVersion?: string | null;
  observedVersion?: string | null;
  renewalDate?: string | null;
  endOfSupportAt?: string | null;
  endOfLifeAt?: string | null;
  warrantyEndAt?: string | null;
  licenseQuantity?: number | null;
  billingCadence?: string | null;
  customerChargeModel?: string | null;
  evidenceSource?: string | null;
  evidenceNotes?: string | null;
};

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "mb-1 block text-xs text-[var(--dpf-muted)]";

function normalizeDateInput(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

export function EditCustomerConfigurationItemButton({
  accountId,
  item,
  siteOptions,
  itemTypeOptions,
  chargeModelOptions,
  defaultOpen = false,
}: {
  accountId: string;
  item: EditableCustomerConfigurationItem;
  siteOptions: Array<{ id: string; name: string }>;
  itemTypeOptions: ItemTypeOption[];
  chargeModelOptions: ChargeModelOption[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [name, setName] = useState(item.name);
  const [ciType, setCiType] = useState(item.ciType);
  const [siteId, setSiteId] = useState(item.siteId ?? "");
  const [supportModel, setSupportModel] = useState(item.supportModel ?? "");
  const [normalizedVersion, setNormalizedVersion] = useState(item.normalizedVersion ?? "");
  const [observedVersion, setObservedVersion] = useState(item.observedVersion ?? "");
  const [renewalDate, setRenewalDate] = useState(normalizeDateInput(item.renewalDate));
  const [endOfSupportAt, setEndOfSupportAt] = useState(normalizeDateInput(item.endOfSupportAt));
  const [endOfLifeAt, setEndOfLifeAt] = useState(normalizeDateInput(item.endOfLifeAt));
  const [warrantyEndAt, setWarrantyEndAt] = useState(normalizeDateInput(item.warrantyEndAt));
  const [licenseQuantity, setLicenseQuantity] = useState(
    item.licenseQuantity !== null && item.licenseQuantity !== undefined ? String(item.licenseQuantity) : "",
  );
  const [billingCadence, setBillingCadence] = useState(item.billingCadence ?? "monthly");
  const [customerChargeModel, setCustomerChargeModel] = useState(
    item.customerChargeModel ?? chargeModelOptions[0]?.key ?? "",
  );
  const [evidenceSource, setEvidenceSource] = useState(item.evidenceSource ?? "");
  const [evidenceNotes, setEvidenceNotes] = useState(item.evidenceNotes ?? "");

  const selectedType =
    itemTypeOptions.find((option) => option.key === ciType) ?? {
      key: item.ciType,
      label: item.ciType,
      technologySourceType: item.technologySourceType,
      supportsLicensing: Boolean(item.licenseQuantity || item.billingCadence || item.customerChargeModel),
    };

  function closeModal() {
    setOpen(false);
    setError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Configuration item name is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await updateCustomerConfigurationItem({
          accountId,
          configurationItemId: item.id,
          siteId: siteId || "",
          name,
          ciType,
          technologySourceType: selectedType.technologySourceType,
          supportModel,
          normalizedVersion,
          observedVersion,
          renewalDate,
          endOfSupportAt,
          endOfLifeAt,
          warrantyEndAt,
          licenseQuantity: selectedType.supportsLicensing && licenseQuantity ? Number(licenseQuantity) : null,
          billingCadence: selectedType.supportsLicensing ? billingCadence : "",
          customerChargeModel: selectedType.supportsLicensing ? customerChargeModel : "",
          evidenceSource,
          evidenceNotes,
          reviewCadenceDays: selectedType.defaultReviewCadenceDays,
        });
        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to update configuration item.",
        );
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
      >
        Edit
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={closeModal} />
          <div className="fixed right-8 top-20 z-50 w-[560px] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--dpf-border)] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Edit Managed Item</h2>
                <p className="text-[10px] text-[var(--dpf-muted)]">{item.customerCiId}</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-lg text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              >
                x
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-4">
              <div>
                <label className={labelClasses}>Name *</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={inputClasses}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClasses}>Managed Item Type</label>
                  <select
                    value={ciType}
                    onChange={(event) => setCiType(event.target.value)}
                    className={inputClasses}
                  >
                    {itemTypeOptions.map((option) => (
                      <option
                        key={option.key}
                        value={option.key}
                        className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClasses}>Customer Site</label>
                  <select
                    value={siteId}
                    onChange={(event) => setSiteId(event.target.value)}
                    className={inputClasses}
                  >
                    <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                      Unassigned
                    </option>
                    {siteOptions.map((site) => (
                      <option
                        key={site.id}
                        value={site.id}
                        className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                      >
                        {site.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClasses}>Technology Source</label>
                  <input value={selectedType.technologySourceType.replace("_", " ")} readOnly className={inputClasses} />
                </div>
                <div>
                  <label className={labelClasses}>Support Model</label>
                  <select
                    value={supportModel}
                    onChange={(event) => setSupportModel(event.target.value)}
                    className={inputClasses}
                  >
                    <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Unknown</option>
                    <option value="vendor_contract" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Vendor Contract</option>
                    <option value="subscription" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Subscription</option>
                    <option value="community" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Community</option>
                    <option value="lts" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">LTS</option>
                    <option value="partner" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Partner</option>
                  </select>
                </div>
                <div>
                  <label className={labelClasses}>Normalized Version</label>
                  <input
                    value={normalizedVersion}
                    onChange={(event) => setNormalizedVersion(event.target.value)}
                    className={inputClasses}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClasses}>Observed Version</label>
                  <input
                    value={observedVersion}
                    onChange={(event) => setObservedVersion(event.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Renewal Date</label>
                  <input
                    type="date"
                    value={renewalDate}
                    onChange={(event) => setRenewalDate(event.target.value)}
                    className={inputClasses}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClasses}>End of Support</label>
                  <input
                    type="date"
                    value={endOfSupportAt}
                    onChange={(event) => setEndOfSupportAt(event.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>End of Life</label>
                  <input
                    type="date"
                    value={endOfLifeAt}
                    onChange={(event) => setEndOfLifeAt(event.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Warranty End</label>
                  <input
                    type="date"
                    value={warrantyEndAt}
                    onChange={(event) => setWarrantyEndAt(event.target.value)}
                    className={inputClasses}
                  />
                </div>
              </div>

              {selectedType.supportsLicensing ? (
                <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
                    Licensing & Billing Readiness
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelClasses}>Quantity</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={licenseQuantity}
                        onChange={(event) => setLicenseQuantity(event.target.value)}
                        className={inputClasses}
                      />
                    </div>
                    <div>
                      <label className={labelClasses}>Billing Cadence</label>
                      <select
                        value={billingCadence}
                        onChange={(event) => setBillingCadence(event.target.value)}
                        className={inputClasses}
                      >
                        <option value="monthly" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Monthly</option>
                        <option value="quarterly" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Quarterly</option>
                        <option value="annual" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Annual</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClasses}>Charge Model</label>
                      <select
                        value={customerChargeModel}
                        onChange={(event) => setCustomerChargeModel(event.target.value)}
                        className={inputClasses}
                      >
                        {chargeModelOptions.map((option) => (
                          <option
                            key={option.key}
                            value={option.key}
                            className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
                  Lifecycle Evidence
                </p>
                <div className="space-y-3">
                  <div>
                    <label className={labelClasses}>Evidence Source</label>
                    <input
                      value={evidenceSource}
                      onChange={(event) => setEvidenceSource(event.target.value)}
                      placeholder="Vendor lifecycle page or release policy"
                      className={inputClasses}
                    />
                  </div>
                  <div>
                    <label className={labelClasses}>Evidence Notes</label>
                    <textarea
                      value={evidenceNotes}
                      onChange={(event) => setEvidenceNotes(event.target.value)}
                      rows={3}
                      className={inputClasses}
                    />
                  </div>
                </div>
              </div>

              {error ? <p className="text-xs text-red-500">{error}</p> : null}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Save Managed Item"}
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}
