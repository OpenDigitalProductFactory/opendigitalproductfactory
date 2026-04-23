"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createCustomerConfigurationItem } from "@/lib/actions/crm";

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

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "mb-1 block text-xs text-[var(--dpf-muted)]";

export function NewCustomerConfigurationItemButton({
  accountId,
  siteOptions,
  itemTypeOptions,
  chargeModelOptions,
}: {
  accountId: string;
  siteOptions: Array<{ id: string; name: string }>;
  itemTypeOptions: ItemTypeOption[];
  chargeModelOptions: ChargeModelOption[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const defaultItemType = itemTypeOptions[0];
  const [name, setName] = useState("");
  const [ciType, setCiType] = useState(defaultItemType?.key ?? "custom");
  const [siteId, setSiteId] = useState("");
  const [normalizedVersion, setNormalizedVersion] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [endOfSupportAt, setEndOfSupportAt] = useState("");
  const [licenseQuantity, setLicenseQuantity] = useState("");
  const [billingCadence, setBillingCadence] = useState("monthly");
  const [customerChargeModel, setCustomerChargeModel] = useState(
    defaultItemType?.defaultChargeModel ?? chargeModelOptions[0]?.key ?? "",
  );

  const selectedType =
    itemTypeOptions.find((option) => option.key === ciType) ??
    defaultItemType ?? {
      key: "custom",
      label: "Custom",
      technologySourceType: "commercial" as const,
      supportsLicensing: false,
    };

  function resetForm() {
    setName("");
    setCiType(defaultItemType?.key ?? "custom");
    setSiteId("");
    setNormalizedVersion("");
    setRenewalDate("");
    setEndOfSupportAt("");
    setLicenseQuantity("");
    setBillingCadence("monthly");
    setCustomerChargeModel(defaultItemType?.defaultChargeModel ?? chargeModelOptions[0]?.key ?? "");
    setError(null);
  }

  function closeModal() {
    setOpen(false);
    resetForm();
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
        await createCustomerConfigurationItem({
          accountId,
          siteId: siteId || undefined,
          name,
          ciType,
          technologySourceType: selectedType.technologySourceType,
          normalizedVersion: normalizedVersion || undefined,
          renewalDate: renewalDate || undefined,
          endOfSupportAt: endOfSupportAt || undefined,
          licenseQuantity: selectedType.supportsLicensing && licenseQuantity ? Number(licenseQuantity) : undefined,
          billingCadence: selectedType.supportsLicensing ? billingCadence : undefined,
          customerChargeModel: selectedType.supportsLicensing ? customerChargeModel || undefined : undefined,
          reviewCadenceDays: selectedType.defaultReviewCadenceDays,
        });
        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create configuration item.",
        );
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        + New Managed Item
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={closeModal} />
          <div className="fixed right-8 top-20 z-50 w-[520px] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--dpf-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--dpf-text)]">New Managed Item</h2>
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
                  placeholder="e.g. SentinelOne Complete"
                  className={inputClasses}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClasses}>Managed Item Type</label>
                  <select
                    value={ciType}
                    onChange={(event) => {
                      const nextType = itemTypeOptions.find((option) => option.key === event.target.value);
                      setCiType(event.target.value);
                      if (nextType?.defaultChargeModel) {
                        setCustomerChargeModel(nextType.defaultChargeModel);
                      }
                    }}
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClasses}>Technology Source</label>
                  <input value={selectedType.technologySourceType.replace("_", " ")} readOnly className={inputClasses} />
                </div>
                <div>
                  <label className={labelClasses}>Version / Release</label>
                  <input
                    value={normalizedVersion}
                    onChange={(event) => setNormalizedVersion(event.target.value)}
                    placeholder="e.g. 22.04 LTS"
                    className={inputClasses}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClasses}>Renewal Date</label>
                  <input
                    type="date"
                    value={renewalDate}
                    onChange={(event) => setRenewalDate(event.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>End of Support</label>
                  <input
                    type="date"
                    value={endOfSupportAt}
                    onChange={(event) => setEndOfSupportAt(event.target.value)}
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
              ) : (
                <p className="text-[10px] text-[var(--dpf-muted)]">
                  This archetype treats this managed item type as non-licensed by default.
                </p>
              )}

              {selectedType.defaultReviewCadenceDays ? (
                <p className="text-[10px] text-[var(--dpf-muted)]">
                  Default lifecycle review cadence: every {selectedType.defaultReviewCadenceDays} days.
                </p>
              ) : null}

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
                  {isPending ? "Creating..." : "Create Managed Item"}
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}
