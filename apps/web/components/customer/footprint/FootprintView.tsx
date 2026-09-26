"use client";

// Market footprint world view (BI-4EC1D572). One layer at a time over a static
// Equal Earth SVG of the world, with a table at parity. Colours come only from
// --dpf-* tokens; every state is also carried by a pattern, outline or text so
// colour is never the only signal (WCAG 1.4.1).

import { useMemo, useState } from "react";

import type { CountryFootprint, MarketFootprint } from "@/lib/footprint/market-footprint";
import { customerShadeStep, languageFitFor, type LanguageFit } from "@/lib/footprint/market-footprint";
import { WORLD_COUNTRY_PATHS } from "@/lib/footprint/world-country-paths";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { DataTable, type Column } from "@/components/ui/report-kit";

export type FootprintLayer = "targets" | "customers" | "deployments" | "language";

function layersFor(people: string): Array<{ key: FootprintLayer; label: string; description: string }> {
  return [
  { key: "targets", label: "Target markets", description: "Countries you sell to or operate in." },
  { key: "customers", label: people, description: `${people} with a site in each country.` },
  { key: "deployments", label: "Deployments", description: "Customer sites running an installed node with an active fulfilment." },
  { key: "language", label: "Language fit", description: "Countries where a language the platform supports is official (filled), where one is planned (striped), and where none is yet (dotted)." },
  ];
}

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
    const { fit } = languageFitFor(isoA2);
    if (fit === "supported") return "color-mix(in srgb, var(--dpf-accent) 55%, var(--dpf-surface-2))";
    if (fit === "planned") return "url(#footprint-planned)";
    return "url(#footprint-dots)";
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

let languageNames: Intl.DisplayNames | null = null;

function languageName(code: string): string {
  try {
    languageNames ??= new Intl.DisplayNames(["en"], { type: "language" });
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function languageFitText(fit: LanguageFit, languages: string[]): string {
  const names = languages.map(languageName).join(", ");
  if (fit === "supported") return `Supported (${names})`;
  if (fit === "planned") return `Planned (${names})`;
  return "No supported language yet";
}

function layerValue(layer: FootprintLayer, country: CountryFootprint, people: string): string {
  switch (layer) {
    case "targets":
      return country.targetMarket ? "Target market" : "Not targeted";
    case "customers":
      return `${people}: ${country.customerCount}`;
    case "deployments":
      return `${country.deploymentCount} deployment${country.deploymentCount === 1 ? "" : "s"}`;
    case "language":
      return languageFitText(country.languageFit, country.languages);
  }
}

export function FootprintView({ footprint, peopleLabel }: { footprint: MarketFootprint; peopleLabel: string }) {
  const LAYERS = layersFor(peopleLabel);
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
          <Button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={layer === entry.key}
            variant={layer === entry.key ? "primary" : "secondary"}
            onClick={() => setLayer(entry.key)}
            className="min-h-[44px]"
          >
            {entry.label}
          </Button>
        ))}
      </div>
      <p className="text-sm text-[var(--dpf-muted)]">{active.description}</p>

      <Surface padding="sm">
      <figure>
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
            <pattern id="footprint-planned" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <rect width="6" height="6" fill={LAND} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--dpf-warning)" strokeWidth="2.5" />
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
                <title>{country ? `${country.name}: ${layerValue(layer, country, peopleLabel)}` : layer === "language" && shape.isoA2 ? `${shape.name}: ${(() => { const f = languageFitFor(shape.isoA2); return languageFitText(f.fit, f.languages); })()}` : shape.name}</title>
              </path>
            );
          })}
        </svg>
        <figcaption className="px-2 pt-1 text-xs text-[var(--dpf-muted)]">
          Country outlines: Natural Earth (public domain). Equal Earth projection.
        </figcaption>
      </figure>
      </Surface>

      {selectedCountry && (
        <p aria-live="polite" className="text-sm text-[var(--dpf-text)]">
          <span className="font-semibold">{selectedCountry.name}</span>: {layerValue("targets", selectedCountry, peopleLabel)} ·{" "}
          {layerValue("customers", selectedCountry, peopleLabel)} · {layerValue("deployments", selectedCountry, peopleLabel)} ·{" "}
          {layerValue("language", selectedCountry, peopleLabel)}
        </p>
      )}

      <FootprintTable
        countries={footprint.countries}
        unplacedCustomers={footprint.unplacedCustomers}
        unplacedDeployments={footprint.unplacedDeployments}
        peopleLabel={peopleLabel}
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
  peopleLabel,
  selected,
  onSelect,
}: {
  countries: CountryFootprint[];
  unplacedCustomers: number;
  unplacedDeployments: number;
  peopleLabel: string;
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  const columns: Column<CountryFootprint>[] = [
    {
      key: "country",
      header: "Country",
      sortAccessor: (row) => row.name,
      cell: (row) => (
        <button
          type="button"
          aria-pressed={selected === row.isoA2}
          onClick={() => onSelect(row.isoA2)}
          className={`min-h-[32px] text-left underline-offset-2 hover:underline ${
            selected === row.isoA2 ? "font-semibold underline" : ""
          }`}
        >
          {row.name}
        </button>
      ),
    },
    { key: "target", header: "Target market", sortAccessor: (row) => (row.targetMarket ? 1 : 0), cell: (row) => (row.targetMarket ? "Yes" : "No") },
    { key: "customers", header: peopleLabel, align: "right", sortAccessor: (row) => row.customerCount, cell: (row) => row.customerCount },
    { key: "deployments", header: "Deployments", align: "right", sortAccessor: (row) => row.deploymentCount, cell: (row) => row.deploymentCount },
    { key: "language", header: "Language", cell: (row) => languageFitText(row.languageFit, row.languages) },
  ];

  return (
    <div className="space-y-2">
      {(unplacedCustomers > 0 || unplacedDeployments > 0) && (
        <p className="text-sm text-[var(--dpf-text)]">
          <span className="font-semibold">Not placed:</span> {peopleLabel}: {unplacedCustomers} · Deployments:{" "}
          {unplacedDeployments} — no site, or no country on the site address.
        </p>
      )}
      <DataTable
        columns={columns}
        rows={countries}
        getRowKey={(row) => row.isoA2}
        initialSort={{ key: "customers", dir: "desc" }}
        ariaLabel="Market footprint by country"
        empty="No countries to show yet."
      />
    </div>
  );
}
