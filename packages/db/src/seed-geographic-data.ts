// packages/db/src/seed-geographic-data.ts
//
// Seeds geographic reference data: Countries, Regions (states/provinces), and Cities.
// Reads from static JSON data files in packages/db/data/.
//
// Idempotent: safe to run multiple times. Uses upsert for countries (unique iso2),
// and findFirst + P2002-tolerant create for regions/cities — both carry a
// case-insensitive unique index that a case-sensitive findFirst can disagree
// with (see seedRegionOnce / seedCityOnce).

import { readFileSync } from "fs";
import { join } from "path";
import type { PrismaClient } from "../generated/client/client";
import { normalizeLocalityName } from "./location-normalize";

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

/**
 * Outcome of attempting to seed a single region, plus the row's db id (so the
 * caller can build the region-key map even when our findFirst missed the row).
 */
export type SeedRegionOutcome = "created" | "existing" | "skipped_duplicate";

/**
 * Idempotently seed one region, tolerating both findFirst-doesn't-see-it
 * (cold path, normal create) and P2002 (the row exists but our lookup index
 * disagreed with the unique constraint).
 *
 * The Region model carries a case-insensitive unique index
 *   Region_countryId_name_ci ON (LOWER("name"), "countryId")
 * while the findFirst below matches "name" case-sensitively. Source data with
 * near-duplicate casing/accents — or a concurrent cold-install seeder racing on
 * the same row — passes the case-sensitive lookup but collides on the index, so
 * the bare create throws P2002 and (previously) aborted the whole seed run.
 * This mirrors seedCityOnce, which hardened the identical failure for cities
 * (BI-E4E21A7F). On a swallowed duplicate we re-resolve the row case-
 * insensitively so the region-key map still gets a usable id.
 */
export async function seedRegionOnce(
  prisma: PrismaClient,
  countryDbId: string,
  region: RegionRecord,
): Promise<{ outcome: SeedRegionOutcome; id: string | null }> {
  const found = await prisma.region.findFirst({
    where: { countryId: countryDbId, name: region.name },
    select: { id: true },
  });

  if (found) return { outcome: "existing", id: found.id };

  try {
    const record = await prisma.region.create({
      data: {
        name: region.name,
        code: region.code || null,
        countryId: countryDbId,
      },
    });
    return { outcome: "created", id: record.id };
  } catch (err: unknown) {
    // Prisma P2002 = unique constraint violation. Anything else re-throws.
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2002") throw err;
    // The case-insensitive unique index rejected a case/accent variant our
    // case-sensitive findFirst missed (or a concurrent seeder won the race).
    // Re-resolve the winning row so the region key still maps to a real id.
    const dup = await prisma.region.findFirst({
      where: { countryId: countryDbId, name: { equals: region.name, mode: "insensitive" } },
      select: { id: true },
    });
    return { outcome: "skipped_duplicate", id: dup?.id ?? null };
  }
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
  let skippedDuplicate = 0;

  for (const r of regions) {
    const countryDbId = countryIdMap.get(r.countryCode);
    if (!countryDbId) continue;

    const { outcome, id } = await seedRegionOnce(prisma, countryDbId, r);
    if (id) regionKeyToDbId.set(`${r.countryCode}::${r.code}`, id);
    if (outcome === "created") created++;
    else if (outcome === "existing") existing++;
    else skippedDuplicate++;
  }

  const regionCount = created + existing + skippedDuplicate;
  log(
    `  Regions: ${created} created, ${existing} already existed, ${skippedDuplicate} skipped (duplicate index). Total: ${regionCount}`,
  );
  return { regionKeyToDbId, regionCount };
}

/**
 * Outcome of attempting to seed a single city. Exported so seed runners and
 * tests can reason about counts without re-deriving them.
 */
export type SeedCityOutcome = "created" | "existing" | "skipped_duplicate";

/**
 * Idempotently seed one city, tolerating both findFirst-doesn't-see-it
 * (cold path, normal create) and P2002 (the row exists but our lookup index
 * disagreed with the unique constraint).
 *
 * The City model has two unique constraints that can disagree:
 *   (1) UNIQUE (LOWER("name"), regionId)                          — case-insensitive raw name
 *   (2) UNIQUE (regionId, nameNormalized) WHERE disambiguator IS NULL — accent-folded
 * The findFirst checks (2). Source data with near-duplicates (e.g. accented
 * vs. unaccented variants of the same city) can pass (2) but collide on (1).
 *
 * Without P2002 tolerance, seedCities crashes mid-run and
 * seedPromptTemplates never executes — which is what produced
 * BI-E4E21A7F (fresh installs ship with stale coworker prompts).
 */
export async function seedCityOnce(
  prisma: PrismaClient,
  regionDbId: string,
  city: CityRecord,
): Promise<SeedCityOutcome> {
  const found = await prisma.city.findFirst({
    where: { regionId: regionDbId, nameNormalized: normalizeLocalityName(city.name) },
    select: { id: true },
  });

  if (found) return "existing";

  try {
    await prisma.city.create({
      data: {
        name: city.name,
        nameNormalized: normalizeLocalityName(city.name),
        regionId: regionDbId,
      },
    });
    return "created";
  } catch (err: unknown) {
    // Prisma P2002 = unique constraint violation. Anything else re-throws.
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2002") return "skipped_duplicate";
    throw err;
  }
}

async function seedCities(
  prisma: PrismaClient,
  regionKeyToDbId: Map<string, string>,
): Promise<number> {
  const cities = loadJson<CityRecord>("cities.json");

  log(`Seeding ${cities.length} cities...`);

  let created = 0;
  let existing = 0;
  let skippedDuplicate = 0;
  const BATCH_LOG_INTERVAL = 1000;

  for (let i = 0; i < cities.length; i++) {
    const c = cities[i]!;
    const regionDbId = regionKeyToDbId.get(`${c.countryCode}::${c.regionCode}`);
    if (!regionDbId) continue;

    const outcome = await seedCityOnce(prisma, regionDbId, c);
    if (outcome === "created") created++;
    else if (outcome === "existing") existing++;
    else skippedDuplicate++;

    if ((i + 1) % BATCH_LOG_INTERVAL === 0) {
      log(`  Progress: ${i + 1}/${cities.length} cities processed...`);
    }
  }

  if (skippedDuplicate > 0) {
    log(
      `  Cities: ${created} created, ${existing} already existed, ${skippedDuplicate} skipped (P2002 duplicate). ` +
        `Total: ${created + existing + skippedDuplicate}`,
    );
  } else {
    log(`  Cities: ${created} created, ${existing} already existed. Total: ${created + existing}`);
  }
  return created + existing + skippedDuplicate;
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
