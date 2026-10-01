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
import { useMessagesContext } from "@/lib/i18n/messages-context";
import { useT } from "@/lib/i18n/use-t";

type FootprintT = ReturnType<typeof useT<"footprint">>;

export type FootprintLayer = "targets" | "customers" | "deployments" | "language";

function layersFor(t: FootprintT, people: string): Array<{ key: FootprintLayer; label: string; description: string }> {
  return [
    { key: "targets", label: t("layers.targets"), description: t("layers.targetsDescription") },
    { key: "customers", label: people, description: t("layers.customersDescription", { people }) },
    { key: "deployments", label: t("layers.deployments"), description: t("layers.deploymentsDescription") },
    { key: "language", label: t("layers.language"), description: t("layers.languageDescription") },
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

function languageName(locale: string, code: string): string {
  try {
    if (languageNames?.resolvedOptions().locale !== locale) {
      languageNames = new Intl.DisplayNames([locale], { type: "language" });
    }
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function languageFitText(t: FootprintT, locale: string, fit: LanguageFit, languages: string[]): string {
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    languages.map((code) => languageName(locale, code)),
  );
  if (fit === "supported") return t("values.languageSupported", { languages: names });
  if (fit === "planned") return t("values.languagePlanned", { languages: names });
  return t("values.languageNone");
}

function layerValue(t: FootprintT, locale: string, layer: FootprintLayer, country: CountryFootprint, people: string): string {
  switch (layer) {
    case "targets":
      return country.targetMarket ? t("values.targetYes") : t("values.targetNo");
    case "customers":
      return t("values.customers", { people, count: country.customerCount });
    case "deployments":
      return t("values.deployments", { count: country.deploymentCount });
    case "language":
      return languageFitText(t, locale, country.languageFit, country.languages);
  }
}

export function FootprintView({ footprint, peopleLabel }: { footprint: MarketFootprint; peopleLabel: string }) {
  const t = useT("footprint");
  const { locale } = useMessagesContext();
  const LAYERS = layersFor(t, peopleLabel);
  const value = (which: FootprintLayer, country: CountryFootprint) => layerValue(t, locale, which, country, peopleLabel);
  const shapeTitle = (name: string, isoA2: string | null, country: CountryFootprint | undefined) => {
    if (country) return `${country.name}: ${value(layer, country)}`;
    if (layer === "language" && isoA2) {
      const fit = languageFitFor(isoA2);
      return `${name}: ${languageFitText(t, locale, fit.fit, fit.languages)}`;
    }
    return name;
  };
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
      <div role="radiogroup" aria-label={t("layers.groupLabel")} className="flex flex-wrap gap-2">
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
          aria-label={t("map.label", { layer: active.label })}
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
                <title>{shapeTitle(shape.name, shape.isoA2, country)}</title>
              </path>
            );
          })}
        </svg>
        <figcaption className="px-2 pt-1 text-xs text-[var(--dpf-muted)]">
          {t("map.caption")}
        </figcaption>
      </figure>
      </Surface>

      {selectedCountry && (
        <p aria-live="polite" className="text-sm text-[var(--dpf-text)]">
          <span className="font-semibold">{selectedCountry.name}</span>:{" "}
          {(["targets", "customers", "deployments", "language"] as const).map((which) => value(which, selectedCountry)).join(" · ")}
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
  const t = useT("footprint");
  const { locale } = useMessagesContext();
  const columns: Column<CountryFootprint>[] = [
    {
      key: "country",
      header: t("table.country"),
      sortAccessor: (row) => row.name,
      cell: (row) => (
        <button
          type="button"
          aria-pressed={selected === row.isoA2}
          onClick={() => onSelect(row.isoA2)}
          className={`min-h-[32px] text-start underline-offset-2 hover:underline ${
            selected === row.isoA2 ? "font-semibold underline" : ""
          }`}
        >
          {row.name}
        </button>
      ),
    },
    { key: "target", header: t("table.target"), sortAccessor: (row) => (row.targetMarket ? 1 : 0), cell: (row) => (row.targetMarket ? t("table.yes") : t("table.no")) },
    { key: "customers", header: peopleLabel, align: "right", sortAccessor: (row) => row.customerCount, cell: (row) => row.customerCount },
    { key: "deployments", header: t("table.deployments"), align: "right", sortAccessor: (row) => row.deploymentCount, cell: (row) => row.deploymentCount },
    { key: "language", header: t("table.language"), cell: (row) => languageFitText(t, locale, row.languageFit, row.languages) },
  ];

  return (
    <div className="space-y-2">
      {(unplacedCustomers > 0 || unplacedDeployments > 0) && (
        <p className="text-sm text-[var(--dpf-text)]">
          <span className="font-semibold">{t("table.notPlaced")}</span>{" "}
          {t("table.notPlacedDetail", { people: peopleLabel, customers: unplacedCustomers, deployments: unplacedDeployments })}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={countries}
        getRowKey={(row) => row.isoA2}
        initialSort={{ key: "customers", dir: "desc" }}
        ariaLabel={t("table.label")}
        empty={t("table.empty")}
      />
    </div>
  );
}
