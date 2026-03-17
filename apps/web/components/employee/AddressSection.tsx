"use client";

import { useState, useTransition, useCallback } from "react";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import {
  searchCountries,
  searchRegions,
  searchCities,
  createRegion,
  createCity,
} from "@/lib/actions/reference-data";
import {
  createEmployeeAddress,
  deleteEmployeeAddress,
  setPrimaryAddress,
} from "@/lib/actions/address";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AddressWithHierarchy = {
  id: string;
  isPrimary: boolean;
  address: {
    id: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    validatedAt: Date | null;
    validationSource: string | null;
    city: {
      id: string;
      name: string;
      region: {
        id: string;
        name: string;
        code: string | null;
        country: { id: string; name: string; iso2: string; phoneCode: string };
      };
    };
  };
};

type Props = {
  employeeProfileId: string;
  addresses: AddressWithHierarchy[];
};

type RefItem = { id: string; label: string };

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AddressSection({
  employeeProfileId,
  addresses,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [label, setLabel] = useState<string>("home");
  const [country, setCountry] = useState<RefItem | null>(null);
  const [region, setRegion] = useState<RefItem | null>(null);
  const [city, setCity] = useState<RefItem | null>(null);
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [makePrimary, setMakePrimary] = useState(addresses.length === 0);

  // -------------------------------------------------------------------------
  // Search adapters
  // -------------------------------------------------------------------------

  const searchCountryAdapter = useCallback(
    async (q: string): Promise<RefItem[]> => {
      const results = await searchCountries(q);
      return results.map((c) => ({
        id: c.id,
        label: `${c.name} (${c.iso2})`,
      }));
    },
    [],
  );

  const searchRegionAdapter = useCallback(
    async (q: string): Promise<RefItem[]> => {
      if (!country) return [];
      const results = await searchRegions(country.id, q);
      return results.map((r) => ({
        id: r.id,
        label: r.code ? `${r.name} (${r.code})` : r.name,
      }));
    },
    [country],
  );

  const searchCityAdapter = useCallback(
    async (q: string): Promise<RefItem[]> => {
      if (!region) return [];
      const results = await searchCities(region.id, q);
      return results.map((c) => ({
        id: c.id,
        label: c.name,
      }));
    },
    [region],
  );

  // -------------------------------------------------------------------------
  // Cascade handlers
  // -------------------------------------------------------------------------

  const handleCountrySelect = useCallback((item: RefItem) => {
    setCountry(item);
    setRegion(null);
    setCity(null);
  }, []);

  const handleRegionSelect = useCallback((item: RefItem) => {
    setRegion(item);
    setCity(null);
  }, []);

  const handleCitySelect = useCallback((item: RefItem) => {
    setCity(item);
  }, []);

  // -------------------------------------------------------------------------
  // onAddNew handlers
  // -------------------------------------------------------------------------

  const handleAddNewRegion = useCallback(
    (name: string) => {
      if (!country) return;
      startTransition(async () => {
        const result = await createRegion(country.id, name, undefined);
        if (result.ok && result.created) {
          setRegion({
            id: result.created.id,
            label: result.created.code
              ? `${result.created.name} (${result.created.code})`
              : result.created.name,
          });
          setCity(null);
          setError(null);
        } else if (result.suggestions && result.suggestions.length > 0) {
          const names = result.suggestions
            .map((s) => (s.code ? `${s.name} (${s.code})` : s.name))
            .join(", ");
          setError(`${result.message} ${names}`);
        } else {
          setError(result.message);
        }
      });
    },
    [country],
  );

  const handleAddNewCity = useCallback(
    (name: string) => {
      if (!region) return;
      startTransition(async () => {
        const result = await createCity(region.id, name);
        if (result.ok && result.created) {
          setCity({
            id: result.created.id,
            label: result.created.name,
          });
          setError(null);
        } else if (result.suggestions && result.suggestions.length > 0) {
          const names = result.suggestions.map((s) => s.name).join(", ");
          setError(`${result.message} ${names}`);
        } else {
          setError(result.message);
        }
      });
    },
    [region],
  );

  // -------------------------------------------------------------------------
  // Save / Delete / Set Primary
  // -------------------------------------------------------------------------

  function handleSave() {
    if (!city) {
      setError("Please select a city.");
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
    setCountry(null);
    setRegion(null);
    setCity(null);
    setAddressLine1("");
    setAddressLine2("");
    setPostalCode("");
    setMakePrimary(addresses.length === 0);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--dpf-foreground)]">
        Addresses
      </h3>

      {/* Existing addresses */}
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

      {/* Add address toggle */}
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

      {/* Add address form */}
      {showForm && (
        <div className="space-y-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          {error && (
            <div className="rounded border border-red-400 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Label */}
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

          {/* Country */}
          <div>
            <label className={labelCls}>Country</label>
            <ReferenceTypeahead
              placeholder="Search countries..."
              onSearch={searchCountryAdapter}
              onSelect={handleCountrySelect}
              value={country}
            />
          </div>

          {/* Region */}
          <div>
            <label className={labelCls}>Region</label>
            <ReferenceTypeahead
              placeholder="Search regions..."
              onSearch={searchRegionAdapter}
              onSelect={handleRegionSelect}
              onAddNew={country ? handleAddNewRegion : undefined}
              addNewLabel="Add new region"
              value={region}
              disabled={!country}
            />
          </div>

          {/* City */}
          <div>
            <label className={labelCls}>City</label>
            <ReferenceTypeahead
              placeholder="Search cities..."
              onSearch={searchCityAdapter}
              onSelect={handleCitySelect}
              onAddNew={region ? handleAddNewCity : undefined}
              addNewLabel="Add new city"
              value={city}
              disabled={!region}
            />
          </div>

          {/* Address Line 1 */}
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

          {/* Address Line 2 */}
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

          {/* Postal Code */}
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

          {/* Primary checkbox */}
          <label className="flex items-center gap-2 text-xs text-[var(--dpf-foreground)]">
            <input
              type="checkbox"
              checked={makePrimary}
              onChange={(e) => setMakePrimary(e.target.checked)}
              className="accent-[var(--dpf-accent)]"
            />
            Set as primary address
          </label>

          {/* Actions */}
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
