"use client";

import { useState, useTransition, useMemo } from "react";
import {
  LocationCascadePicker,
  type LocationSelection,
} from "@/components/location/LocationCascadePicker";
import {
  createCity,
  createRegion,
  searchCities,
  searchCountries,
  searchRegions,
} from "@/lib/actions/reference-data";
import {
  createEmployeeAddress,
  deleteEmployeeAddress,
  setPrimaryAddress,
} from "@/lib/actions/address";
import type { AddressWithHierarchy } from "@/lib/address-types";

type Props = {
  employeeProfileId: string;
  addresses: AddressWithHierarchy[];
};

const LABEL_OPTIONS = [
  "home",
  "work",
  "billing",
  "shipping",
  "headquarters",
  "site",
] as const;

const labelCls =
  "block text-xs font-medium text-[var(--dpf-muted)] mb-1";
const inputCls =
  "w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]";
const primaryBtnCls =
  "rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50";
const secondaryBtnCls =
  "rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]";

const EMPTY_LOCATION: LocationSelection = {
  country: null,
  region: null,
  locality: null,
};

function formatAddress(a: AddressWithHierarchy["address"]): string {
  const parts = [a.addressLine1];
  if (a.addressLine2) parts.push(a.addressLine2);
  parts.push(a.city.name);
  if (a.city.region.code) {
    parts.push(a.city.region.code);
  } else {
    parts.push(a.city.region.name);
  }
  parts.push(a.postalCode);
  parts.push(a.city.region.country.name);
  return parts.join(", ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function AddressSection({
  employeeProfileId,
  addresses,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [label, setLabel] = useState<string>("home");
  const [locationSelection, setLocationSelection] =
    useState<LocationSelection>(EMPTY_LOCATION);
  const city = locationSelection.locality;
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [makePrimary, setMakePrimary] = useState(addresses.length === 0);

  const cascadeAdapters = useMemo(
    () => ({
      searchCountries: async (q: string) => {
        const results = await searchCountries(q);
        return results.map((c) => ({ id: c.id, label: `${c.name} (${c.iso2})` }));
      },
      searchRegions: async (countryId: string, q: string) => {
        const results = await searchRegions(countryId, q);
        return results.map((r) => ({
          id: r.id,
          label: r.code ? `${r.name} (${r.code})` : r.name,
        }));
      },
      searchLocalities: async (regionId: string, q: string) => {
        const results = await searchCities(regionId, q);
        return results.map((c) => ({ id: c.id, label: c.name }));
      },
    }),
    [],
  );

  function handleSave() {
    if (!city) {
      setError("Please select a locality.");
      return;
    }
    if (!addressLine1.trim()) {
      setError("Address line 1 is required.");
      return;
    }
    if (!postalCode.trim()) {
      setError("Postal code is required.");
      return;
    }

    startTransition(async () => {
      const result = await createEmployeeAddress({
        employeeProfileId,
        label,
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2.trim() || null,
        cityId: city.id,
        postalCode: postalCode.trim(),
        isPrimary: makePrimary,
      });

      if (result.ok) {
        resetForm();
      } else {
        setError(result.message);
      }
    });
  }

  function handleDelete(employeeAddressId: string) {
    startTransition(async () => {
      const result = await deleteEmployeeAddress(employeeAddressId);
      if (!result.ok) {
        setError(result.message);
      }
    });
  }

  function handleSetPrimary(employeeAddressId: string) {
    startTransition(async () => {
      const result = await setPrimaryAddress(employeeAddressId);
      if (!result.ok) {
        setError(result.message);
      }
    });
  }

  function resetForm() {
    setShowForm(false);
    setError(null);
    setLabel("home");
    setLocationSelection(EMPTY_LOCATION);
    setAddressLine1("");
    setAddressLine2("");
    setPostalCode("");
    setMakePrimary(addresses.length === 0);
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--dpf-foreground)]">
        Addresses
      </h3>

      {addresses.map((ea) => (
        <div
          key={ea.id}
          className="flex items-start justify-between gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-[var(--dpf-foreground)]">
                {capitalize(ea.address.label)}
              </span>
              {ea.isPrimary && (
                <span className="rounded bg-[var(--dpf-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Primary
                </span>
              )}
              {ea.address.validatedAt && (
                <span className="text-green-500" title="Validated">
                  &#10003;
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--dpf-muted)] break-words">
              {formatAddress(ea.address)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!ea.isPrimary && (
              <button
                type="button"
                onClick={() => handleSetPrimary(ea.id)}
                disabled={isPending}
                className="text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)] disabled:opacity-50"
                title="Set as primary"
              >
                &#9734;
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDelete(ea.id)}
              disabled={isPending}
              className="text-sm text-[var(--dpf-muted)] hover:text-red-500 disabled:opacity-50"
              title="Delete address"
            >
              &times;
            </button>
          </div>
        </div>
      ))}

      {!showForm && (
        <button
          type="button"
          onClick={() => {
            setMakePrimary(addresses.length === 0);
            setShowForm(true);
          }}
          className={secondaryBtnCls}
        >
          + Add address
        </button>
      )}

      {showForm && (
        <div className="space-y-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          {error && (
            <div className="rounded border border-red-400 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className={labelCls}>Label</label>
            <select
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputCls}
            >
              {LABEL_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {capitalize(l)}
                </option>
              ))}
            </select>
          </div>

          <LocationCascadePicker
            value={locationSelection}
            onChange={setLocationSelection}
            searchCountries={cascadeAdapters.searchCountries}
            searchRegions={cascadeAdapters.searchRegions}
            searchLocalities={cascadeAdapters.searchLocalities}
            onCreateRegion={(name, countryId) => createRegion(countryId, name, undefined)}
            onCreateLocality={(name, regionId) => createCity(regionId, name)}
          />

          <div>
            <label className={labelCls}>Address Line 1</label>
            <input
              type="text"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="123 Main St"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Address Line 2</label>
            <input
              type="text"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Apt, suite, etc. (optional)"
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Postal Code</label>
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="94102"
              className={inputCls}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--dpf-foreground)]">
            <input
              type="checkbox"
              checked={makePrimary}
              onChange={(e) => setMakePrimary(e.target.checked)}
              className="accent-[var(--dpf-accent)]"
            />
            Set as primary address
          </label>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className={primaryBtnCls}
            >
              {isPending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={isPending}
              className={secondaryBtnCls}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
