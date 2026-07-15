// packages/db/src/seed-geographic-data.test.ts
//
// Regression test for BI-E4E21A7F: seedCities used to crash on P2002 unique
// constraint violations, which aborted the rest of the seed (notably
// seedPromptTemplates), so fresh installs shipped with stale coworker prompts.
//
// The contract under test is seedCityOnce: it must tolerate both
//   (a) findFirst-misses-but-row-exists (raised as P2002 by Prisma)
//   (b) cold-path creates (no row exists)
// and must NOT swallow non-P2002 errors.

import { describe, it, expect } from "vitest";
import { seedCityOnce, seedRegionOnce } from "./seed-geographic-data";
import type { PrismaClient } from "../generated/client/client";

type CityFindFirst = (args: {
  where: { regionId: string; nameNormalized: string };
  select: { id: true };
}) => Promise<{ id: string } | null>;

type CityCreate = (args: {
  data: { name: string; nameNormalized: string; regionId: string };
}) => Promise<{ id: string }>;

function buildPrismaStub(opts: {
  findFirst: CityFindFirst;
  create: CityCreate;
}): PrismaClient {
  return {
    city: { findFirst: opts.findFirst, create: opts.create },
  } as unknown as PrismaClient;
}

const cityRecord = (name: string) => ({
  name,
  regionCode: "CA",
  countryCode: "US",
});

describe("seedCityOnce", () => {
  it("creates the city when findFirst returns null and create succeeds", async () => {
    let captured: Parameters<CityCreate>[0] | null = null;
    const create: CityCreate = async (args) => {
      captured = args;
      return { id: "city-1" };
    };
    const prisma = buildPrismaStub({
      findFirst: async () => null,
      create,
    });

    const outcome = await seedCityOnce(prisma, "region-1", cityRecord("Anaheim"));

    expect(outcome).toBe("created");
    expect(captured).not.toBeNull();
    expect(captured!.data).toMatchObject({
      name: "Anaheim",
      regionId: "region-1",
    });
  });

  it("reports 'existing' without calling create when findFirst hits a row", async () => {
    let createCalls = 0;
    const create: CityCreate = async () => {
      createCalls++;
      return { id: "city-x" };
    };
    const prisma = buildPrismaStub({
      findFirst: async () => ({ id: "city-existing" }),
      create,
    });

    const outcome = await seedCityOnce(prisma, "region-1", cityRecord("Los Angeles"));

    expect(outcome).toBe("existing");
    expect(createCalls).toBe(0);
  });

  it("swallows P2002 unique-constraint violations as 'skipped_duplicate' (BI-E4E21A7F regression)", async () => {
    // Simulates the index-disagreement scenario:
    //   findFirst (regionId, nameNormalized) returns null
    //   but create trips the (LOWER(name), regionId) unique index
    let createCalls = 0;
    const create: CityCreate = async () => {
      createCalls++;
      const err = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["regionId", "name"] },
      });
      throw err;
    };
    const prisma = buildPrismaStub({
      findFirst: async () => null,
      create,
    });

    const outcome = await seedCityOnce(prisma, "region-1", cityRecord("São Paulo"));

    expect(outcome).toBe("skipped_duplicate");
    expect(createCalls).toBe(1);
  });

  it("re-throws non-P2002 Prisma errors so genuine bugs surface", async () => {
    const create: CityCreate = async () => {
      const err = Object.assign(new Error("connection lost"), { code: "P1001" });
      throw err;
    };
    const prisma = buildPrismaStub({
      findFirst: async () => null,
      create,
    });

    await expect(seedCityOnce(prisma, "region-1", cityRecord("Boston"))).rejects.toThrow(
      /connection lost/,
    );
  });

  it("re-throws errors that lack a code field", async () => {
    const create: CityCreate = async () => {
      throw new Error("unrelated failure");
    };
    const prisma = buildPrismaStub({
      findFirst: async () => null,
      create,
    });

    await expect(seedCityOnce(prisma, "region-1", cityRecord("Toronto"))).rejects.toThrow(
      /unrelated failure/,
    );
  });
});

type RegionFindFirst = (args: {
  where: {
    countryId: string;
    name: string | { equals: string; mode: "insensitive" };
  };
  select: { id: true };
}) => Promise<{ id: string } | null>;

type RegionCreate = (args: {
  data: { name: string; code: string | null; countryId: string };
}) => Promise<{ id: string }>;

function buildRegionStub(opts: {
  findFirst: RegionFindFirst;
  create: RegionCreate;
}): PrismaClient {
  return {
    region: { findFirst: opts.findFirst, create: opts.create },
  } as unknown as PrismaClient;
}

const regionRecord = (name: string) => ({ name, code: "CA", countryCode: "US" });

describe("seedRegionOnce", () => {
  it("creates the region and returns its id when findFirst misses and create succeeds", async () => {
    let captured: Parameters<RegionCreate>[0] | null = null;
    const prisma = buildRegionStub({
      findFirst: async () => null,
      create: async (args) => {
        captured = args;
        return { id: "region-new" };
      },
    });

    const result = await seedRegionOnce(prisma, "country-1", regionRecord("California"));

    expect(result).toEqual({ outcome: "created", id: "region-new" });
    expect(captured!.data).toMatchObject({ name: "California", code: "CA", countryId: "country-1" });
  });

  it("reports 'existing' with the found id and does not call create", async () => {
    let createCalls = 0;
    const prisma = buildRegionStub({
      findFirst: async () => ({ id: "region-existing" }),
      create: async () => {
        createCalls++;
        return { id: "region-x" };
      },
    });

    const result = await seedRegionOnce(prisma, "country-1", regionRecord("Ontario"));

    expect(result).toEqual({ outcome: "existing", id: "region-existing" });
    expect(createCalls).toBe(0);
  });

  it("swallows P2002 as 'skipped_duplicate' and re-resolves the winning row's id", async () => {
    // findFirst is case-sensitive (misses "québec"); the case-insensitive
    // unique index rejects the create; the P2002 branch re-queries insensitively.
    let findCalls = 0;
    const prisma = buildRegionStub({
      findFirst: async (args) => {
        findCalls++;
        // First (case-sensitive) lookup misses; second (insensitive) hits.
        return typeof args.where.name === "object" ? { id: "region-dup" } : null;
      },
      create: async () => {
        throw Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
          meta: { target: ["countryId", "name"] },
        });
      },
    });

    const result = await seedRegionOnce(prisma, "country-1", regionRecord("Québec"));

    expect(result).toEqual({ outcome: "skipped_duplicate", id: "region-dup" });
    expect(findCalls).toBe(2);
  });

  it("returns a null id (not a crash) if the duplicate row cannot be re-resolved", async () => {
    const prisma = buildRegionStub({
      findFirst: async () => null,
      create: async () => {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      },
    });

    const result = await seedRegionOnce(prisma, "country-1", regionRecord("Ghost"));

    expect(result).toEqual({ outcome: "skipped_duplicate", id: null });
  });

  it("re-throws non-P2002 errors so genuine failures surface", async () => {
    const prisma = buildRegionStub({
      findFirst: async () => null,
      create: async () => {
        throw Object.assign(new Error("connection lost"), { code: "P1001" });
      },
    });

    await expect(seedRegionOnce(prisma, "country-1", regionRecord("Boston"))).rejects.toThrow(
      /connection lost/,
    );
  });
});
