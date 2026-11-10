// Market footprint — the pure core of the country-level world view (BI-4EC1D572).
//
// Turns rows the server loader already fetched into one summary per country:
// target markets, customers, deployments and language fit. Pure so it is
// testable without Prisma. Nothing here is ever silently dropped — customers or
// deployments with no country are counted as "unplaced".
//
// Design: docs/superpowers/specs/2026-09-26-market-footprint-world-view-design.md

import { localesWithStatus } from "@dpf/i18n";

import { WORLD_COUNTRY_PATHS } from "./world-country-paths";

/**
 * Countries where each language the platform knows is an official or de facto
 * national language, keyed by primary language subtag. Which languages count as
 * supported or planned comes from the locale registry (@dpf/i18n), so language
 * fit follows the product as locales ship. Source: CLDR territory language data
 * (official / de facto official), sovereign states and major territories.
 * locales.test in this directory fails if the registry names a language this
 * table does not cover.
 */
export const OFFICIAL_LANGUAGE_COUNTRIES: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set([
    "AG", "AI", "AS", "AU", "BB", "BI", "BM", "BS", "BW", "BZ", "CA", "CK", "CM", "DM", "FJ", "FK",
    "FM", "GB", "GD", "GG", "GH", "GI", "GM", "GU", "GY", "IE", "IM", "IN", "JE", "JM", "KE", "KI",
    "KN", "KY", "LC", "LR", "LS", "MH", "MP", "MT", "MU", "MW", "NA", "NG", "NR", "NU", "NZ", "PG",
    "PH", "PK", "PR", "PW", "RW", "SB", "SC", "SD", "SG", "SH", "SL", "SS", "SX", "SZ", "TC", "TO",
    "TT", "TV", "TZ", "UG", "US", "VC", "VG", "VI", "VU", "WS", "ZA", "ZM", "ZW",
  ]),
  es: new Set([
    "AR", "BO", "CL", "CO", "CR", "CU", "DO", "EC", "ES", "GQ", "GT", "HN", "MX", "NI", "PA", "PE",
    "PR", "PY", "SV", "UY", "VE",
  ]),
  ar: new Set([
    "AE", "BH", "DJ", "DZ", "EG", "EH", "ER", "IQ", "JO", "KM", "KW", "LB", "LY", "MA", "MR", "OM",
    "PS", "QA", "SA", "SD", "SO", "SY", "TD", "TN", "YE",
  ]),
};

export type LanguageFit = "supported" | "planned" | "none";

function primaryLanguage(tag: string): string {
  return tag.split("-")[0].toLowerCase();
}

/** Primary languages per registry status; pseudo-locales are QA-only and ignored. */
export function registryLanguages(): { supported: string[]; planned: string[] } {
  const supported = new Set(localesWithStatus("supported").map((entry) => primaryLanguage(entry.tag)));
  const planned = new Set(
    localesWithStatus("planned")
      .map((entry) => primaryLanguage(entry.tag))
      .filter((language) => !supported.has(language)),
  );
  return { supported: [...supported], planned: [...planned] };
}

/** Whether a supported (or planned) platform language is official in a country. */
export function languageFitFor(isoA2: string): { fit: LanguageFit; languages: string[] } {
  const code = isoA2.toUpperCase();
  const { supported, planned } = registryLanguages();
  const official = (list: string[]) => list.filter((language) => OFFICIAL_LANGUAGE_COUNTRIES[language]?.has(code));
  const supportedHere = official(supported);
  if (supportedHere.length > 0) return { fit: "supported", languages: supportedHere };
  const plannedHere = official(planned);
  if (plannedHere.length > 0) return { fit: "planned", languages: plannedHere };
  return { fit: "none", languages: [] };
}

export interface FootprintAccountRow {
  accountId: string;
  /** ISO alpha-2 of each of the account's live sites; null where unresolved. */
  siteCountries: Array<string | null>;
}

export interface FootprintDeploymentRow {
  siteId: string;
  country: string | null;
}

export interface MarketFootprintInput {
  /** Country-code arrays from BusinessContext.sellsTo, .operatesIn, and the like. */
  targetMarkets: ReadonlyArray<ReadonlyArray<string>>;
  accounts: ReadonlyArray<FootprintAccountRow>;
  deploymentSites: ReadonlyArray<FootprintDeploymentRow>;
}

export interface CountryFootprint {
  isoA2: string;
  name: string;
  targetMarket: boolean;
  customerCount: number;
  deploymentCount: number;
  languageFit: LanguageFit;
  /** Registry languages official here (supported first, else planned). */
  languages: string[];
}

export interface MarketFootprint {
  countries: CountryFootprint[];
  targetMarketCount: number;
  placedCustomers: number;
  unplacedCustomers: number;
  deploymentCount: number;
  unplacedDeployments: number;
  maxCustomerCount: number;
  hasAnyData: boolean;
}

const MAP_NAMES = new Map(
  WORLD_COUNTRY_PATHS.countries
    .filter((country) => country.isoA2 !== null)
    .map((country) => [country.isoA2 as string, country.name]),
);

let regionNames: Intl.DisplayNames | null = null;

/** English display name for a country code; map names first, then Intl. */
export function countryName(isoA2: string): string {
  const fromMap = MAP_NAMES.get(isoA2);
  if (fromMap) return fromMap;
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(isoA2) ?? isoA2;
  } catch {
    return isoA2;
  }
}

function normalize(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

export function buildMarketFootprint(input: MarketFootprintInput): MarketFootprint {
  const targets = new Set<string>();
  for (const list of input.targetMarkets) {
    for (const code of list) {
      const normalized = normalize(code);
      if (normalized) targets.add(normalized);
    }
  }

  const customers = new Map<string, number>();
  let placedCustomers = 0;
  let unplacedCustomers = 0;
  for (const account of input.accounts) {
    const countries = new Set(
      account.siteCountries.map(normalize).filter((code): code is string => code !== null),
    );
    if (countries.size === 0) {
      unplacedCustomers += 1;
      continue;
    }
    placedCustomers += 1;
    for (const code of countries) customers.set(code, (customers.get(code) ?? 0) + 1);
  }

  const deployments = new Map<string, number>();
  let deploymentCount = 0;
  let unplacedDeployments = 0;
  for (const site of input.deploymentSites) {
    const code = normalize(site.country);
    if (!code) {
      unplacedDeployments += 1;
      continue;
    }
    deploymentCount += 1;
    deployments.set(code, (deployments.get(code) ?? 0) + 1);
  }

  const codes = new Set([...targets, ...customers.keys(), ...deployments.keys()]);
  const countries: CountryFootprint[] = [...codes].map((isoA2) => ({
    isoA2,
    name: countryName(isoA2),
    targetMarket: targets.has(isoA2),
    customerCount: customers.get(isoA2) ?? 0,
    deploymentCount: deployments.get(isoA2) ?? 0,
    ...(() => {
      const { fit, languages } = languageFitFor(isoA2);
      return { languageFit: fit, languages };
    })(),
  }));
  countries.sort(
    (left, right) =>
      right.customerCount - left.customerCount ||
      right.deploymentCount - left.deploymentCount ||
      left.name.localeCompare(right.name),
  );

  return {
    countries,
    targetMarketCount: targets.size,
    placedCustomers,
    unplacedCustomers,
    deploymentCount,
    unplacedDeployments,
    maxCustomerCount: Math.max(0, ...customers.values()),
    hasAnyData: codes.size > 0 || unplacedCustomers > 0 || unplacedDeployments > 0,
  };
}

/** Five shading steps for the customers layer, relative to the busiest country. */
export function customerShadeStep(count: number, max: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5))) as 1 | 2 | 3 | 4 | 5;
}
