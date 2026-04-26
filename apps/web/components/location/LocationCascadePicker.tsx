"use client";

import { useCallback, useState, useTransition } from "react";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import type { CreateRefResult } from "@/lib/actions/reference-data";

export type RefItem = { id: string; label: string };

export type LocationSelection = {
  country: RefItem | null;
  region: RefItem | null;
  locality: RefItem | null;
};

type Suggestion = { id: string; name: string; code?: string | null };

type Props = {
  value: LocationSelection;
  onChange: (value: LocationSelection) => void;
  searchCountries: (query: string) => Promise<RefItem[]>;
  searchRegions: (countryId: string, query: string) => Promise<RefItem[]>;
  searchLocalities: (regionId: string, query: string) => Promise<RefItem[]>;
  onCreateRegion?: (name: string, countryId: string) => Promise<CreateRefResult>;
  onCreateLocality?: (name: string, regionId: string) => Promise<CreateRefResult>;
};

const labelCls = "block text-xs font-medium text-[var(--dpf-muted)] mb-1";
const helpCls = "mt-1 text-xs text-[var(--dpf-muted)]";

function suggestionLabel(item: Suggestion): string {
  return item.code ? `${item.name} (${item.code})` : item.name;
}

export function LocationCascadePicker({
  value,
  onChange,
  searchCountries,
  searchRegions,
  searchLocalities,
  onCreateRegion,
  onCreateLocality,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [pendingSuggestionTarget, setPendingSuggestionTarget] = useState<"region" | "locality" | null>(null);

  const setCountry = useCallback(
    (country: RefItem | null) => {
      setMessage(null);
      setSuggestions([]);
      setPendingSuggestionTarget(null);
      onChange({ country, region: null, locality: null });
    },
    [onChange],
  );

  const setRegion = useCallback(
    (region: RefItem | null) => {
      setMessage(null);
      setSuggestions([]);
      setPendingSuggestionTarget(null);
      onChange({ country: value.country, region, locality: null });
    },
    [onChange, value.country],
  );

  const setLocality = useCallback(
    (locality: RefItem | null) => {
      setMessage(null);
      setSuggestions([]);
      setPendingSuggestionTarget(null);
      onChange({ country: value.country, region: value.region, locality });
    },
    [onChange, value.country, value.region],
  );

  const createRegion = useCallback(
    (name: string) => {
      if (!value.country || !onCreateRegion) return;
      startTransition(async () => {
        const result = await onCreateRegion(name, value.country!.id);
        if (result.ok && result.created) {
          setRegion({ id: result.created.id, label: suggestionLabel(result.created) });
        } else {
          setMessage(result.message);
          setSuggestions(result.suggestions ?? []);
          setPendingSuggestionTarget("region");
        }
      });
    },
    [onCreateRegion, setRegion, value.country],
  );

  const createLocality = useCallback(
    (name: string) => {
      if (!value.region || !onCreateLocality) return;
      startTransition(async () => {
        const result = await onCreateLocality(name, value.region!.id);
        if (result.ok && result.created) {
          setLocality({ id: result.created.id, label: result.created.name });
        } else {
          setMessage(result.message);
          setSuggestions(result.suggestions ?? []);
          setPendingSuggestionTarget("locality");
        }
      });
    },
    [onCreateLocality, setLocality, value.region],
  );

  const pickSuggestion = useCallback(
    (item: Suggestion) => {
      const ref: RefItem = { id: item.id, label: suggestionLabel(item) };
      if (pendingSuggestionTarget === "region") {
        setRegion(ref);
      } else {
        setLocality(ref);
      }
    },
    [pendingSuggestionTarget, setLocality, setRegion],
  );

  return (
    <div className="space-y-3 text-[var(--dpf-text)]">
      {message && (
        <div
          role="alert"
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]"
        >
          <p>{message}</p>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => pickSuggestion(item)}
                  className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]"
                >
                  {suggestionLabel(item)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <label htmlFor="location-country" className={labelCls}>Country</label>
        <ReferenceTypeahead
          inputId="location-country"
          placeholder="Search countries..."
          onSearch={searchCountries}
          onSelect={setCountry}
          value={value.country}
        />
      </div>

      <div>
        <label htmlFor="location-region" className={labelCls}>Region</label>
        <ReferenceTypeahead
          inputId="location-region"
          placeholder="Search regions..."
          onSearch={(query) => (value.country ? searchRegions(value.country.id, query) : Promise.resolve([]))}
          onSelect={setRegion}
          onAddNew={value.country && onCreateRegion ? createRegion : undefined}
          addNewLabel="Add new region"
          value={value.region}
          disabled={!value.country || isPending}
        />
        {!value.country && <p className={helpCls}>Select a country first.</p>}
      </div>

      <div>
        <label htmlFor="location-locality" className={labelCls}>Locality</label>
        <ReferenceTypeahead
          inputId="location-locality"
          placeholder="Search towns, cities, or localities..."
          onSearch={(query) => (value.region ? searchLocalities(value.region.id, query) : Promise.resolve([]))}
          onSelect={setLocality}
          onAddNew={value.region && onCreateLocality ? createLocality : undefined}
          addNewLabel="Add new locality"
          value={value.locality}
          disabled={!value.region || isPending}
        />
        {!value.region && <p className={helpCls}>Select a region first.</p>}
      </div>
    </div>
  );
}
