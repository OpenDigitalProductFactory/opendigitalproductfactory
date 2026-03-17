// Seed script: populate the Country table with ISO 3166-1 data
// Run: cd packages/db && npx tsx scripts/seed-countries.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/client";

interface CountryEntry {
  name: string;
  iso2: string;
  iso3: string;
  numericCode: string;
  phoneCode: string;
}

const countriesPath = resolve(__dirname, "countries.json");
const countries: CountryEntry[] = JSON.parse(readFileSync(countriesPath, "utf-8"));

async function main() {
  console.log(`Seeding ${countries.length} countries...`);
  let created = 0;
  let skipped = 0;

  for (const c of countries) {
    const existing = await prisma.country.findUnique({ where: { iso2: c.iso2 } });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.country.create({
      data: {
        name: c.name,
        iso2: c.iso2,
        iso3: c.iso3,
        numericCode: c.numericCode,
        phoneCode: c.phoneCode,
      },
    });
    created++;
  }

  console.log(`Done: ${created} created, ${skipped} already existed.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
