"use client";

// Market footprint world view (BI-4EC1D572). One layer at a time over a static
// Equal Earth SVG of the world, with a table at parity. Colours come only from
// --dpf-* tokens; every state is also carried by a pattern, outline or text so
// colour is never the only signal (WCAG 1.4.1).

import { useMemo, useState } from "react";

import type { CountryFootprint, MarketFootprint } from "@/lib/footprint/market-footprint";
import { customerShadeStep, hasEnglishAsOfficialLanguage } from "@/lib/footprint/market-footprint";
import { WORLD_COUNTRY_PATHS } from "@/lib/footprint/world-country-paths";

export type FootprintLayer = "targets" | "customers" | "deployments" | "language";

const LAYERS: Array<{ key: FootprintLayer; label: string; description: string }> = [
  { key: "targets", label: "Target markets", description: "Countries you sell to or operate in." },
  { key: "customers", label: "Customers", description: "Customer accounts with a site in each country." },
  { key: "deployments", label: "Deployments", description: "Customer sites running an installed node with an active fulfilment." },
  { key: "language", label: "Language fit", description: "Countries where English is an official language. The platform is English-only." },
];

const SHADE_PERCENT = [0, 22, 38, 55, 72, 90] as const;

// Land with no value for the current layer. Mixed toward --dpf-muted so every
// country separates from the ocean (--dpf-bg) in light and dark themes.
const LAND = "color-mix(in srgb, var(--dpf-muted) 85%, var(--dpf-surface-2))";

function countryFill(
  layer: FootprintLayer,
  isoA2: string | null,
  country: CountryFootprint | undefined,
  maxCustomers: number,
): string {
  const base = LAND;
  // Language fit describes every country, not only those already in the footprint:
  // it answers "where could an English-only product sell?".
  if (layer === "language") {
    if (!isoA2) return base;
    return hasEnglishAsOfficialLanguage(isoA2)
      ? "color-mix(in srgb, var(--dpf-accent) 55%, var(--dpf-surface-2))"
      : "url(#footprint-dots)";
  }
  if (!country) return base;
  switch (layer) {
    case "targets":
      return country.targetMarket ? "url(#footprint-hatch)" : base;
    case "customers": {
      const step = customerShadeStep(country.customerCount, maxCustomers);
      return step === 0 ? base : `color-mix(in srgb, var(--dpf-accent) ${SHADE_PERCENT[step]}%, ${LAND})`;
    }
    case "deployments":
      return country.deploymentCount > 0 ? "color-mix(in srgb, var(--dpf-success) 70%, var(--dpf-surface-2))" : base;
    default:
      return base;
  }
}

function layerValue(layer: FootprintLayer, country: CountryFootprint): string {
  switch (layer) {
    case "targets":
      return country.targetMarket ? "Target market" : "Not targeted";
    case "customers":
      return `${country.customerCount} customer${country.customerCount === 1 ? "" : "s"}`;
    case "deployments":
      return `${country.deploymentCount} deployment${country.deploymentCount === 1 ? "" : "s"}`;
    case "language":
      return country.languageFit ? "English is official" : "English is not official";
  }
}

export function FootprintView({ footprint }: { footprint: MarketFootprint }) {
  const [layer, setLayer] = useState<FootprintLayer>("customers");
  const [selected, setSelected] = useState<string | null>(null);

  const byCode = useMemo(
    () => new Map(footprint.countries.map((country) => [country.isoA2, country])),
    [footprint.countries],
  );
  const active = LAYERS.find((entry) => entry.key === layer)!;
  const selectedCountry = selected ? byCode.get(selected) : undefined;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Map layer" className="flex flex-wrap gap-2">
        {LAYERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={layer === entry.key}
            onClick={() => setLayer(entry.key)}
            className={`min-h-[44px] rounded-md border px-3 text-sm font-medium ${
              layer === entry.key
                ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
                : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-[var(--dpf-muted)]">{active.description}</p>

      <figure className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2">
        <svg
          viewBox={WORLD_COUNTRY_PATHS.viewBox}
          role="img"
          aria-label={`World map, ${active.label} layer. The table below lists the same countries.`}
          className="h-auto w-full"
        >
          <defs>
            <pattern id="footprint-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="color-mix(in srgb, var(--dpf-accent) 35%, var(--dpf-surface-2))" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--dpf-accent)" strokeWidth="2.5" />
            </pattern>
            <pattern id="footprint-dots" width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill={LAND} />
              <circle cx="2.5" cy="2.5" r="0.9" fill="var(--dpf-muted)" />
            </pattern>
          </defs>
          <path d={WORLD_COUNTRY_PATHS.sphere} fill="var(--dpf-bg)" stroke="var(--dpf-border)" strokeWidth="0.6" />
          {WORLD_COUNTRY_PATHS.countries.map((shape, index) => {
            const country = shape.isoA2 ? byCode.get(shape.isoA2) : undefined;
            const isSelected = shape.isoA2 !== null && shape.isoA2 === selected;
            const deployed = layer === "deployments" && (country?.deploymentCount ?? 0) > 0;
            return (
              <path
                key={`${shape.isoA2 ?? "x"}-${index}`}
                d={shape.d}
                fill={countryFill(layer, shape.isoA2, country, footprint.maxCustomerCount)}
                stroke={isSelected ? "var(--dpf-text)" : deployed ? "var(--dpf-success)" : "var(--dpf-bg)"}
                strokeWidth={isSelected ? 2 : deployed ? 1.4 : 0.5}
                onClick={country ? () => setSelected(shape.isoA2) : undefined}
                className={country ? "cursor-pointer" : undefined}
              >
                <title>{country ? `${country.name}: ${layerValue(layer, country)}` : layer === "language" && shape.isoA2 ? `${shape.name}: ${hasEnglishAsOfficialLanguage(shape.isoA2) ? "English is official" : "English is not official"}` : shape.name}</title>
              </path>
            );
          })}
        </svg>
        <figcaption className="px-2 pt-1 text-xs text-[var(--dpf-muted)]">
          Country outlines: Natural Earth (public domain). Equal Earth projection.
        </figcaption>
      </figure>

      {selectedCountry && (
        <p aria-live="polite" className="text-sm text-[var(--dpf-text)]">
          <span className="font-semibold">{selectedCountry.name}</span>: {layerValue("targets", selectedCountry)} ·{" "}
          {layerValue("customers", selectedCountry)} · {layerValue("deployments", selectedCountry)} ·{" "}
          {layerValue("language", selectedCountry)}
        </p>
      )}

      <FootprintTable
        countries={footprint.countries}
        unplacedCustomers={footprint.unplacedCustomers}
        unplacedDeployments={footprint.unplacedDeployments}
        selected={selected}
        onSelect={setSelected}
      />
    </div>
  );
}

export function FootprintTable({
  countries,
  unplacedCustomers,
  unplacedDeployments,
  selected,
  onSelect,
}: {
  countries: CountryFootprint[];
  unplacedCustomers: number;
  unplacedDeployments: number;
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)]">
      <table className="w-full text-left text-sm text-[var(--dpf-text)]">
        <caption className="sr-only">Market footprint by country</caption>
        <thead className="bg-[var(--dpf-surface-2)] text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
          <tr>
            <th scope="col" className="px-3 py-2">Country</th>
            <th scope="col" className="px-3 py-2">Target market</th>
            <th scope="col" className="px-3 py-2 text-right">Customers</th>
            <th scope="col" className="px-3 py-2 text-right">Deployments</th>
            <th scope="col" className="px-3 py-2">English official</th>
          </tr>
        </thead>
        <tbody>
          {(unplacedCustomers > 0 || unplacedDeployments > 0) && (
            <tr className="border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              <th scope="row" className="px-3 py-2 font-medium">Not placed</th>
              <td className="px-3 py-2 text-[var(--dpf-muted)]">No site or no country on the address</td>
              <td className="px-3 py-2 text-right">{unplacedCustomers}</td>
              <td className="px-3 py-2 text-right">{unplacedDeployments}</td>
              <td className="px-3 py-2">—</td>
            </tr>
          )}
          {countries.map((country) => (
            <tr
              key={country.isoA2}
              aria-selected={selected === country.isoA2}
              className={`border-t border-[var(--dpf-border)] ${selected === country.isoA2 ? "bg-[var(--dpf-accent-soft)]" : ""}`}
            >
              <th scope="row" className="px-3 py-2 font-medium">
                <button type="button" onClick={() => onSelect(country.isoA2)} className="min-h-[32px] text-left underline-offset-2 hover:underline">
                  {country.name}
                </button>
              </th>
              <td className="px-3 py-2">{country.targetMarket ? "Yes" : "No"}</td>
              <td className="px-3 py-2 text-right">{country.customerCount}</td>
              <td className="px-3 py-2 text-right">{country.deploymentCount}</td>
              <td className="px-3 py-2">{country.languageFit ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
