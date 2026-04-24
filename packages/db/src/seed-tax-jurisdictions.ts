import { readFileSync } from "fs";
import { join } from "path";
import type { Prisma } from "../generated/client/client";
import type { PrismaClient } from "../generated/client/client";

type CountryRecord = {
  name: string;
  iso2: string;
};

type RegionRecord = {
  name: string;
  code: string;
  countryCode: string;
};

type SeedConfig = {
  generatedAt: string;
  sharedSources: {
    usStateDirectory: string;
    euCountryInfo: string;
    euVatOverview: string;
  };
  usStateCodes: string[];
  euCountryCodes: string[];
  defaults: {
    usState: {
      taxTypes: string[];
      localityModel: string;
      cadenceHints: string[];
      filingNotes: string;
    };
    euVat: {
      taxTypes: string[];
      localityModel: string;
      cadenceHints: string[];
      filingNotes: string;
    };
  };
  overrides: Array<{
    jurisdictionRefId: string;
    countryCode: string;
    authorityName: string;
    authorityType: string;
    taxTypes: string[];
    localityModel: string;
    officialWebsiteUrl?: string;
    registrationUrl?: string;
    filingUrl?: string;
    paymentUrl?: string;
    helpUrl?: string;
    cadenceHints: string[];
    filingNotes: string;
    sourceUrls: string[];
    sourceKind: string;
    confidence: string;
    tags: string[];
  }>;
};

export type TaxJurisdictionSeedRecord = {
  jurisdictionRefId: string;
  countryCode: string;
  stateProvinceCode: string | null;
  authorityName: string;
  authorityType: string;
  parentJurisdictionRefId: string | null;
  taxTypes: string[];
  localityModel: string;
  officialWebsiteUrl: string | null;
  registrationUrl: string | null;
  filingUrl: string | null;
  paymentUrl: string | null;
  helpUrl: string | null;
  cadenceHints: string[];
  filingNotes: string;
  automationHints: Record<string, unknown>;
  sourceUrls: string[];
  sourceKind: string;
  confidence: string;
  staleAfterDays: number;
  tags: string[];
};

const DATA_DIR = join(__dirname, "..", "data");

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

function buildUsStateEntries(
  config: SeedConfig,
  regions: RegionRecord[],
): TaxJurisdictionSeedRecord[] {
  const byCode = new Map(
    regions
      .filter((region) => region.countryCode === "US")
      .map((region) => [region.code, region] as const),
  );

  return config.usStateCodes.map((code) => {
    const region = byCode.get(code);
    if (!region) {
      throw new Error(`Missing US region seed data for state code ${code}`);
    }

    return {
      jurisdictionRefId: `TAX-JUR-US-${code}`,
      countryCode: "US",
      stateProvinceCode: code,
      authorityName: region.name,
      authorityType: "state",
      parentJurisdictionRefId: null,
      taxTypes: [...config.defaults.usState.taxTypes],
      localityModel: config.defaults.usState.localityModel,
      officialWebsiteUrl: null,
      registrationUrl: null,
      filingUrl: config.sharedSources.usStateDirectory,
      paymentUrl: config.sharedSources.usStateDirectory,
      helpUrl: config.sharedSources.usStateDirectory,
      cadenceHints: [...config.defaults.usState.cadenceHints],
      filingNotes: config.defaults.usState.filingNotes,
      automationHints: {
        bootstrapMode: "directory_pointer",
        verificationRequired: true,
      },
      sourceUrls: [config.sharedSources.usStateDirectory],
      sourceKind: "directory",
      confidence: "low",
      staleAfterDays: 120,
      tags: ["us_state", "indirect_tax"],
    };
  });
}

function buildEuCountryEntries(
  config: SeedConfig,
  countries: CountryRecord[],
): TaxJurisdictionSeedRecord[] {
  const byIso2 = new Map(countries.map((country) => [country.iso2, country] as const));

  return config.euCountryCodes.map((code) => {
    const country = byIso2.get(code);
    if (!country) {
      throw new Error(`Missing country seed data for EU code ${code}`);
    }

    return {
      jurisdictionRefId: `TAX-JUR-${code}-VAT`,
      countryCode: code,
      stateProvinceCode: null,
      authorityName: country.name,
      authorityType: "country",
      parentJurisdictionRefId: null,
      taxTypes: [...config.defaults.euVat.taxTypes],
      localityModel: config.defaults.euVat.localityModel,
      officialWebsiteUrl: code === "DK" ? "https://skat.dk/en-us/businesses/vat" : null,
      registrationUrl: null,
      filingUrl: config.sharedSources.euCountryInfo,
      paymentUrl: config.sharedSources.euCountryInfo,
      helpUrl: config.sharedSources.euVatOverview,
      cadenceHints: [...config.defaults.euVat.cadenceHints],
      filingNotes: config.defaults.euVat.filingNotes,
      automationHints: {
        bootstrapMode: "commission_directory",
        verificationRequired: true,
      },
      sourceUrls: [config.sharedSources.euCountryInfo, config.sharedSources.euVatOverview],
      sourceKind: "directory",
      confidence: code === "DK" ? "medium" : "low",
      staleAfterDays: 180,
      tags: ["eu_vat"],
    };
  });
}

function buildOverrideEntries(config: SeedConfig): TaxJurisdictionSeedRecord[] {
  return config.overrides.map((entry) => ({
    jurisdictionRefId: entry.jurisdictionRefId,
    countryCode: entry.countryCode,
    stateProvinceCode: null,
    authorityName: entry.authorityName,
    authorityType: entry.authorityType,
    parentJurisdictionRefId: null,
    taxTypes: [...entry.taxTypes],
    localityModel: entry.localityModel,
    officialWebsiteUrl: entry.officialWebsiteUrl ?? null,
    registrationUrl: entry.registrationUrl ?? null,
    filingUrl: entry.filingUrl ?? null,
    paymentUrl: entry.paymentUrl ?? null,
    helpUrl: entry.helpUrl ?? null,
    cadenceHints: [...entry.cadenceHints],
    filingNotes: entry.filingNotes,
    automationHints: {
      bootstrapMode: "official_verified",
      verificationRequired: true,
    },
    sourceUrls: [...entry.sourceUrls],
    sourceKind: entry.sourceKind,
    confidence: entry.confidence,
    staleAfterDays: 180,
    tags: [...entry.tags],
  }));
}

export function buildDefaultTaxJurisdictionSeed(): TaxJurisdictionSeedRecord[] {
  const config = loadJson<SeedConfig>("tax_jurisdiction_reference.json");
  const countries = loadJson<CountryRecord[]>("countries.json");
  const regions = loadJson<RegionRecord[]>("regions.json");

  const base = [
    ...buildUsStateEntries(config, regions),
    ...buildEuCountryEntries(config, countries),
  ];
  const overrides = buildOverrideEntries(config);
  const byId = new Map<string, TaxJurisdictionSeedRecord>();

  for (const entry of base) byId.set(entry.jurisdictionRefId, entry);
  for (const entry of overrides) byId.set(entry.jurisdictionRefId, entry);

  return [...byId.values()].sort((a, b) =>
    a.jurisdictionRefId.localeCompare(b.jurisdictionRefId),
  );
}

export async function seedTaxJurisdictions(prisma: PrismaClient): Promise<void> {
  const config = loadJson<SeedConfig>("tax_jurisdiction_reference.json");
  const researchedAt = new Date(config.generatedAt);
  const records = buildDefaultTaxJurisdictionSeed();

  console.log(`[seed-tax] upserting ${records.length} tax jurisdiction references…`);

  for (const record of records) {
    await prisma.taxJurisdictionReference.upsert({
      where: { jurisdictionRefId: record.jurisdictionRefId },
      update: {
        countryCode: record.countryCode,
        stateProvinceCode: record.stateProvinceCode,
        authorityName: record.authorityName,
        authorityType: record.authorityType,
        parentJurisdictionRefId: record.parentJurisdictionRefId,
        taxTypes: record.taxTypes,
        localityModel: record.localityModel,
        officialWebsiteUrl: record.officialWebsiteUrl,
        registrationUrl: record.registrationUrl,
        filingUrl: record.filingUrl,
        paymentUrl: record.paymentUrl,
        helpUrl: record.helpUrl,
        cadenceHints: record.cadenceHints,
        filingNotes: record.filingNotes,
        automationHints: json(record.automationHints),
        sourceUrls: record.sourceUrls,
        sourceKind: record.sourceKind,
        lastResearchedAt: researchedAt,
        confidence: record.confidence,
        staleAfterDays: record.staleAfterDays,
      },
      create: {
        jurisdictionRefId: record.jurisdictionRefId,
        countryCode: record.countryCode,
        stateProvinceCode: record.stateProvinceCode,
        authorityName: record.authorityName,
        authorityType: record.authorityType,
        parentJurisdictionRefId: record.parentJurisdictionRefId,
        taxTypes: record.taxTypes,
        localityModel: record.localityModel,
        officialWebsiteUrl: record.officialWebsiteUrl,
        registrationUrl: record.registrationUrl,
        filingUrl: record.filingUrl,
        paymentUrl: record.paymentUrl,
        helpUrl: record.helpUrl,
        cadenceHints: record.cadenceHints,
        filingNotes: record.filingNotes,
        automationHints: json(record.automationHints),
        sourceUrls: record.sourceUrls,
        sourceKind: record.sourceKind,
        lastResearchedAt: researchedAt,
        confidence: record.confidence,
        staleAfterDays: record.staleAfterDays,
      },
    });
  }

  console.log("[seed-tax] tax jurisdiction references done");
}
