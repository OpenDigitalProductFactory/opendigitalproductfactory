"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import {
  searchCountries,
  searchRegions,
  searchCities,
} from "@/lib/actions/reference-data";
import {
  linkWorkLocationAddress,
  unlinkWorkLocationAddress,
} from "@/lib/actions/reference-data-admin";

type Address = {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: {
    name: string;
    region: {
      name: string;
      code: string | null;
      country: { name: string };
    };
  };
};

type WorkLocation = {
  id: string;
  name: string;
  locationType: string;
  timezone: string | null;
  addressId: string | null;
  address: Address | null;
};

type Props = {
  workLocations: WorkLocation[];
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

const TYPE_COLORS: Record<string, string> = {
  office: "bg-blue-500/20 text-blue-400",
  remote: "bg-green-500/20 text-green-400",
  hybrid: "bg-yellow-500/20 text-yellow-400",
  customer_site: "bg-purple-500/20 text-purple-400",
};

const inputCls =
  "w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]";

const labelCls = "block text-xs font-medium text-[var(--dpf-muted)] mb-1";

function formatAddress(a: Address): string {
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

export function WorkLocationPanel({ workLocations }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(true);

  // Address form state -- keyed by location ID
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [label, setLabel] = useState<string>("work");
  const [country, setCountry] = useState<RefItem | null>(null);
  const [region, setRegion] = useState<RefItem | null>(null);
  const [city, setCity] = useState<RefItem | null>(null);
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Search adapters
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

  // Cascade handlers
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

  function resetForm() {
    setLinkingId(null);
    setLabel("work");
    setCountry(null);
    setRegion(null);
    setCity(null);
    setAddressLine1("");
    setAddressLine2("");
    setPostalCode("");
    setError(null);
  }

  function handleLink(locationId: string) {
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
      const result = await linkWorkLocationAddress(locationId, {
        label,
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2.trim() || null,
        cityId: city.id,
        postalCode: postalCode.trim(),
      });
      if (result.ok) {
        resetForm();
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  function handleUnlink(locationId: string) {
    startTransition(async () => {
      const result = await unlinkWorkLocationAddress(locationId);
      if (!result.ok) {
        setError(result.message);
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-white">
          Work Locations ({workLocations.length})
        </h3>
        <span className="text-[var(--dpf-muted)] text-sm">
          {open ? "\u25BE" : "\u25B8"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {workLocations.map((loc) => (
            <div
              key={loc.id}
              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-2"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--dpf-foreground)]">
                    {loc.name}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      TYPE_COLORS[loc.locationType] ??
                      "bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]"
                    }`}
                  >
                    {loc.locationType.replace("_", " ")}
                  </span>
                </div>
                {loc.timezone && (
                  <span className="text-xs text-[var(--dpf-muted)]">
                    {loc.timezone}
                  </span>
                )}
              </div>

              {/* Address display or link form */}
              {loc.address ? (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-[var(--dpf-muted)] break-words">
                    {formatAddress(loc.address)}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleUnlink(loc.id)}
                    disabled={isPending}
                    className="shrink-0 rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-red-400 hover:border-red-400 disabled:opacity-50"
                  >
                    Unlink address
                  </button>
                </div>
              ) : linkingId === loc.id ? (
                <div className="space-y-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
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

                  <div>
                    <label className={labelCls}>Country</label>
                    <ReferenceTypeahead
                      placeholder="Search countries..."
                      onSearch={searchCountryAdapter}
                      onSelect={handleCountrySelect}
                      value={country}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Region</label>
                    <ReferenceTypeahead
                      placeholder="Search regions..."
                      onSearch={searchRegionAdapter}
                      onSelect={handleRegionSelect}
                      value={region}
                      disabled={!country}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>City</label>
                    <ReferenceTypeahead
                      placeholder="Search cities..."
                      onSearch={searchCityAdapter}
                      onSelect={handleCitySelect}
                      value={city}
                      disabled={!region}
                    />
                  </div>

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
                      placeholder="Suite, floor (optional)"
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

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleLink(loc.id)}
                      disabled={isPending}
                      className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {isPending ? "Saving..." : "Link address"}
                    </button>
                    <button
                      type="button"
                      onClick={resetForm}
                      disabled={isPending}
                      className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--dpf-muted)]">
                    No address
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setLinkingId(loc.id);
                    }}
                    className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
                  >
                    Link address
                  </button>
                </div>
              )}
            </div>
          ))}

          {workLocations.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
              No work locations defined.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
