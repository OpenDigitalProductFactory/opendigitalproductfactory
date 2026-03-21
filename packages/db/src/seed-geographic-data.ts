// packages/db/src/seed-geographic-data.ts
//
// Seeds geographic reference data: Countries, Regions (states/provinces), and Cities.
// Uses the `country-state-city` npm package for base data and `i18n-iso-countries`
// for ISO 3166-1 alpha-3 and numeric codes.
//
// Idempotent: safe to run multiple times. Uses upsert for countries (unique iso2),
// and findFirst + create for regions/cities (no unique constraint on composite keys).

import { Country, State, City } from "country-state-city";
import * as countries from "i18n-iso-countries";
import type { PrismaClient } from "../generated/client/client";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Countries that get more cities per region (3 per region vs 1 for others) */
const MAJOR_COUNTRY_CODES = new Set([
  "US", "GB", "CA", "AU", "DE", "FR", "IN", "BR", "JP", "CN",
  "IT", "ES", "NL", "MX", "RU", "KR", "SE", "NO", "DK", "FI",
  "PL", "AT", "CH", "IE", "NZ", "SG", "ZA", "AE", "SA", "IL",
]);

const CITIES_PER_REGION_MAJOR = 3;
const CITIES_PER_REGION_OTHER = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a phone code to a consistent format (digits and hyphens only).
 * The source data has mixed formats: "93", "+1-684", "+358-18", etc.
 * We store the raw numeric code without leading +.
 */
function normalizePhoneCode(raw: string): string {
  if (!raw) return "0";
  // Strip leading +, trim whitespace
  return raw.replace(/^\+/, "").trim();
}

/**
 * Log a progress message with a consistent prefix.
 */
function log(msg: string): void {
  console.log(`[seed-geo] ${msg}`);
}

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

async function seedCountries(prisma: PrismaClient): Promise<Map<string, string>> {
  const allCountries = Country.getAllCountries();
  const iso2ToDbId = new Map<string, string>();

  log(`Seeding ${allCountries.length} countries...`);

  for (const c of allCountries) {
    const iso3 = countries.alpha2ToAlpha3(c.isoCode);
    const numericCode = countries.alpha2ToNumeric(c.isoCode);

    if (!iso3 || !numericCode) {
      log(`  SKIP ${c.isoCode} (${c.name}) — missing iso3 or numeric code`);
      continue;
    }

    const record = await prisma.country.upsert({
      where: { iso2: c.isoCode },
      update: {
        name: c.name,
        iso3,
        numericCode,
        phoneCode: normalizePhoneCode(c.phonecode),
      },
      create: {
        name: c.name,
        iso2: c.isoCode,
        iso3,
        numericCode,
        phoneCode: normalizePhoneCode(c.phonecode),
      },
    });

    iso2ToDbId.set(c.isoCode, record.id);
  }

  log(`  Seeded ${iso2ToDbId.size} countries.`);
  return iso2ToDbId;
}

async function seedRegions(
  prisma: PrismaClient,
  countryIdMap: Map<string, string>,
): Promise<{ regionKeyToDbId: Map<string, string>; regionCount: number }> {
  const allStates = State.getAllStates();
  const regionKey = (countryId: string, name: string) => `${countryId}::${name}`;
  const regionKeyToDbId = new Map<string, string>();

  log(`Seeding ${allStates.length} regions/states...`);

  let created = 0;
  let existing = 0;

  for (const s of allStates) {
    const countryDbId = countryIdMap.get(s.countryCode);
    if (!countryDbId) continue; // skip if country was not seeded

    const key = regionKey(countryDbId, s.name);

    // Check if this region already exists
    const found = await prisma.region.findFirst({
      where: { countryId: countryDbId, name: s.name },
      select: { id: true },
    });

    if (found) {
      regionKeyToDbId.set(key, found.id);
      // Also store by countryCode::stateCode for city lookup
      regionKeyToDbId.set(`${s.countryCode}::${s.isoCode}`, found.id);
      existing++;
    } else {
      const record = await prisma.region.create({
        data: {
          name: s.name,
          code: s.isoCode || null,
          countryId: countryDbId,
        },
      });
      regionKeyToDbId.set(key, record.id);
      regionKeyToDbId.set(`${s.countryCode}::${s.isoCode}`, record.id);
      created++;
    }
  }

  const regionCount = created + existing;
  log(`  Regions: ${created} created, ${existing} already existed. Total: ${regionCount}`);
  return { regionKeyToDbId, regionCount };
}

async function seedCities(
  prisma: PrismaClient,
  regionKeyToDbId: Map<string, string>,
): Promise<number> {
  const allCities = City.getAllCities();

  // Group cities by countryCode::stateCode
  const grouped = new Map<string, Array<{ name: string; countryCode: string; stateCode: string }>>();
  for (const c of allCities) {
    const key = `${c.countryCode}::${c.stateCode}`;
    let arr = grouped.get(key);
    if (!arr) {
      arr = [];
      grouped.set(key, arr);
    }
    arr.push(c);
  }

  // Determine how many cities to keep per region
  const citiesToSeed: Array<{ name: string; regionDbId: string }> = [];

  grouped.forEach((cities, key) => {
    const regionDbId = regionKeyToDbId.get(key);
    if (!regionDbId) return; // no matching region in our DB

    const countryCode = key.split("::")[0]!;
    const cap = MAJOR_COUNTRY_CODES.has(countryCode)
      ? CITIES_PER_REGION_MAJOR
      : CITIES_PER_REGION_OTHER;

    const selected = cities.slice(0, cap);
    for (const c of selected) {
      citiesToSeed.push({ name: c.name, regionDbId });
    }
  });

  const totalToSeed = citiesToSeed.length;
  log(`Seeding ${totalToSeed} cities (filtered from ${allCities.length} total)...`);

  let created = 0;
  let existing = 0;

  // Process in batches to show progress
  const BATCH_LOG_INTERVAL = 1000;

  for (let i = 0; i < citiesToSeed.length; i++) {
    const c = citiesToSeed[i]!;

    const found = await prisma.city.findFirst({
      where: { regionId: c.regionDbId, name: c.name },
      select: { id: true },
    });

    if (found) {
      existing++;
    } else {
      await prisma.city.create({
        data: {
          name: c.name,
          regionId: c.regionDbId,
        },
      });
      created++;
    }

    if ((i + 1) % BATCH_LOG_INTERVAL === 0) {
      log(`  Progress: ${i + 1}/${totalToSeed} cities processed...`);
    }
  }

  log(`  Cities: ${created} created, ${existing} already existed. Total: ${created + existing}`);
  return created + existing;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function seedGeographicData(prisma: PrismaClient): Promise<void> {
  log("Starting geographic reference data seed...");
  const startTime = Date.now();

  // Phase 1: Countries (upsert by iso2)
  const countryIdMap = await seedCountries(prisma);

  // Phase 2: Regions / states (findFirst + create)
  const { regionKeyToDbId, regionCount } = await seedRegions(prisma, countryIdMap);

  // Phase 3: Cities (findFirst + create, filtered by tier)
  const cityCount = await seedCities(prisma, regionKeyToDbId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(
    `Complete in ${elapsed}s. Seeded ${countryIdMap.size} countries, ` +
    `${regionCount} regions, ${cityCount} cities.`
  );
}
