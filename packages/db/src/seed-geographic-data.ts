// packages/db/src/seed-geographic-data.ts
//
// Seeds geographic reference data: Countries, Regions (states/provinces), and Cities.
// Reads from static JSON data files in packages/db/data/.
//
// Idempotent: safe to run multiple times. Uses upsert for countries (unique iso2),
// and findFirst + create for regions/cities (no unique constraint on composite keys).

import { readFileSync } from "fs";
import { join } from "path";
import type { PrismaClient } from "../generated/client/client";

// ---------------------------------------------------------------------------
// Data types matching the JSON file schemas
// ---------------------------------------------------------------------------

type CountryRecord = {
  name: string;
  iso2: string;
  iso3: string;
  numericCode: string;
  phoneCode: string;
};

type RegionRecord = {
  name: string;
  code: string;
  countryCode: string;
};

type CityRecord = {
  name: string;
  regionCode: string;
  countryCode: string;
};

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

const DATA_DIR = join(__dirname, "..", "data");

function loadJson<T>(filename: string): T[] {
  const raw = readFileSync(join(DATA_DIR, filename), "utf-8");
  return JSON.parse(raw) as T[];
}

function log(msg: string): void {
  console.log(`[seed-geo] ${msg}`);
}

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

async function seedCountries(prisma: PrismaClient): Promise<Map<string, string>> {
  const countries = loadJson<CountryRecord>("countries.json");
  const iso2ToDbId = new Map<string, string>();

  log(`Seeding ${countries.length} countries...`);

  for (const c of countries) {
    const record = await prisma.country.upsert({
      where: { iso2: c.iso2 },
      update: {
        name: c.name,
        iso3: c.iso3,
        numericCode: c.numericCode,
        phoneCode: c.phoneCode,
      },
      create: {
        name: c.name,
        iso2: c.iso2,
        iso3: c.iso3,
        numericCode: c.numericCode,
        phoneCode: c.phoneCode,
      },
    });

    iso2ToDbId.set(c.iso2, record.id);
  }

  log(`  Seeded ${iso2ToDbId.size} countries.`);
  return iso2ToDbId;
}

async function seedRegions(
  prisma: PrismaClient,
  countryIdMap: Map<string, string>,
): Promise<{ regionKeyToDbId: Map<string, string>; regionCount: number }> {
  const regions = loadJson<RegionRecord>("regions.json");
  const regionKeyToDbId = new Map<string, string>();

  log(`Seeding ${regions.length} regions/states...`);

  let created = 0;
  let existing = 0;

  for (const r of regions) {
    const countryDbId = countryIdMap.get(r.countryCode);
    if (!countryDbId) continue;

    const found = await prisma.region.findFirst({
      where: { countryId: countryDbId, name: r.name },
      select: { id: true },
    });

    if (found) {
      regionKeyToDbId.set(`${r.countryCode}::${r.code}`, found.id);
      existing++;
    } else {
      const record = await prisma.region.create({
        data: {
          name: r.name,
          code: r.code || null,
          countryId: countryDbId,
        },
      });
      regionKeyToDbId.set(`${r.countryCode}::${r.code}`, record.id);
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
  const cities = loadJson<CityRecord>("cities.json");

  log(`Seeding ${cities.length} cities...`);

  let created = 0;
  let existing = 0;
  const BATCH_LOG_INTERVAL = 1000;

  for (let i = 0; i < cities.length; i++) {
    const c = cities[i]!;
    const regionDbId = regionKeyToDbId.get(`${c.countryCode}::${c.regionCode}`);
    if (!regionDbId) continue;

    const found = await prisma.city.findFirst({
      where: { regionId: regionDbId, name: c.name },
      select: { id: true },
    });

    if (found) {
      existing++;
    } else {
      await prisma.city.create({
        data: {
          name: c.name,
          regionId: regionDbId,
        },
      });
      created++;
    }

    if ((i + 1) % BATCH_LOG_INTERVAL === 0) {
      log(`  Progress: ${i + 1}/${cities.length} cities processed...`);
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

  const countryIdMap = await seedCountries(prisma);
  const { regionKeyToDbId, regionCount } = await seedRegions(prisma, countryIdMap);
  const cityCount = await seedCities(prisma, regionKeyToDbId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(
    `Complete in ${elapsed}s. Seeded ${countryIdMap.size} countries, ` +
    `${regionCount} regions, ${cityCount} cities.`
  );
}
