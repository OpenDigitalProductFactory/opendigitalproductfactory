"use client";

import { useState, useTransition, useCallback } from "react";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import {
  searchCountries,
  searchRegions,
  searchCities,
  createRegion,
  createCity,
  forceCreateRegion,
  forceCreateCity,
} from "@/lib/actions/reference-data";
import type { CreateRefResult } from "@/lib/actions/reference-data";
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

type RefItem = { id: string; label: string };

type DuplicateSuggestions = {
  kind: "region" | "city";
  name: string;
  items: { id: string; label: string }[];
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
  const [duplicates, setDuplicates] = useState<DuplicateSuggestions | null>(null);

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
          setDuplicates(null);
        } else if (result.suggestions && result.suggestions.length > 0) {
          setDuplicates({
            kind: "region",
            name,
            items: result.suggestions.map((s) => ({
              id: s.id,
              label: s.code ? `${s.name} (${s.code})` : s.name,
            })),
          });
          setError(result.message);
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
          setDuplicates(null);
        } else if (result.suggestions && result.suggestions.length > 0) {
          setDuplicates({
            kind: "city",
            name,
            items: result.suggestions.map((s) => ({
              id: s.id,
              label: s.name,
            })),
          });
          setError(result.message);
        } else {
          setError(result.message);
        }
      });
    },
    [region],
  );

  const handlePickSuggestion = useCallback(
    (item: RefItem) => {
      if (!duplicates) return;
      if (duplicates.kind === "region") {
        setRegion(item);
        setCity(null);
      } else {
        setCity(item);
      }
      setDuplicates(null);
      setError(null);
    },
    [duplicates],
  );

  const handleForceCreate = useCallback(() => {
    if (!duplicates) return;
    startTransition(async () => {
      let result: CreateRefResult;
      if (duplicates.kind === "region" && country) {
        result = await forceCreateRegion(country.id, duplicates.name, undefined);
        if (result.ok && result.created) {
          setRegion({
            id: result.created.id,
            label: result.created.code
              ? `${result.created.name} (${result.created.code})`
              : result.created.name,
          });
          setCity(null);
        }
      } else if (duplicates.kind === "city" && region) {
        result = await forceCreateCity(region.id, duplicates.name);
        if (result.ok && result.created) {
          setCity({
            id: result.created.id,
            label: result.created.name,
          });
        }
      } else {
        return;
      }

      if (result.ok) {
        setDuplicates(null);
        setError(null);
      } else {
        setError(result.message);
      }
    });
  }, [duplicates, country, region]);

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
    setDuplicates(null);
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

          {/* Duplicate suggestions panel */}
          {duplicates && (
            <div className="rounded border border-yellow-600 bg-yellow-950/30 px-3 py-2 space-y-2">
              <p className="text-xs text-yellow-400">
                Did you mean one of these existing {duplicates.kind === "region" ? "regions" : "cities"}?
              </p>
              <div className="flex flex-wrap gap-1">
                {duplicates.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handlePickSuggestion(item)}
                    disabled={isPending}
                    className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-foreground)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleForceCreate}
                disabled={isPending}
                className="rounded border border-yellow-600 px-2 py-1 text-xs text-yellow-400 hover:bg-yellow-900/40 disabled:opacity-50"
              >
                {isPending ? "Creating..." : `Create "${duplicates.name}" anyway`}
              </button>
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
