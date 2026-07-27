"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { searchCustomerSiteAddresses } from "@/lib/actions/crm";
import type { ValidatedSiteAddress } from "@/lib/shared/site-address-validation";

const inputClasses =
  "w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "mb-1 block text-xs text-[var(--dpf-muted)]";

type Props = {
  value: ValidatedSiteAddress | null;
  onChange: (next: ValidatedSiteAddress | null) => void;
  /** When set, shown while no new selection is chosen (edit flow). */
  currentAddressLabel?: string | null;
  required?: boolean;
};

/**
 * Progressive address lookup: type a query, pick one validated result.
 * Selection carries providerRef for create/update server actions.
 */
export function ValidatedSiteAddressField({
  value,
  onChange,
  currentAddressLabel,
  required = true,
}: Props) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ValidatedSiteAddress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }

    const handle = window.setTimeout(() => {
      startTransition(async () => {
        try {
          setError(null);
          const next = await searchCustomerSiteAddresses(query);
          setResults(next);
          if (next.length === 0) {
            setError("No validated matches. Try a fuller street address.");
          }
        } catch (lookupError) {
          setResults([]);
          setError(
            lookupError instanceof Error
              ? lookupError.message
              : "Address lookup failed.",
          );
        }
      });
    }, 350);

    return () => window.clearTimeout(handle);
  }, [query]);

  return (
    <div className="space-y-2">
      <label className={labelClasses}>
        Validated address{required ? " *" : ""}
      </label>

      {value ? (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
          <p className="text-xs text-[var(--dpf-text)]">{value.label}</p>
          <button
            type="button"
            className="mt-1 text-[10px] text-[var(--dpf-accent)] hover:underline"
            onClick={() => {
              onChange(null);
              setQuery("");
              setResults([]);
            }}
          >
            Change selection
          </button>
        </div>
      ) : (
        <>
          {currentAddressLabel ? (
            <p className="text-[10px] text-[var(--dpf-muted)]">
              Current: {currentAddressLabel}. Search to revalidate and replace.
            </p>
          ) : null}
          <input
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Start typing a street address..."
            className={inputClasses}
            autoComplete="off"
          />
          {isPending ? (
            <p className="text-[10px] text-[var(--dpf-muted)]">Searching...</p>
          ) : null}
          {results.length > 0 ? (
            <ul
              id={listboxId}
              role="listbox"
              className="max-h-40 overflow-y-auto rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
            >
              {results.map((candidate) => (
                <li key={candidate.providerRef} role="option">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
                    onClick={() => {
                      onChange(candidate);
                      setResults([]);
                      setQuery("");
                      setError(null);
                    }}
                  >
                    {candidate.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {error ? <p className="text-xs text-[var(--dpf-text)]">{error}</p> : null}
    </div>
  );
}
