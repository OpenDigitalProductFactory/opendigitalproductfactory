import { prisma } from "@dpf/db";

import {
  seedPerformanceAcceptanceFixture,
  seedSoftwarePerformanceAcceptanceFixture,
  type PerformanceAcceptanceFixtureDatabase,
} from "../lib/demo/performance-acceptance-fixture";

import { loadEnvironmentClassResolution } from "../lib/install/environment-class";
import { aggregateBusinessMetrics } from "../lib/performance/business-metric-rollup";
import { defaultBusinessMetricRollupDeps } from "../lib/performance/business-metric-rollup.server";

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const ownerEmail = option("--owner-email");
  if (!ownerEmail) {
    throw new Error("Usage: pnpm --filter web demo:performance-acceptance -- --owner-email <seeded-owner-email>");
  }
  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: {
      id: true,
      platformSetupProgress: { select: { organizationId: true } },
    },
  });
  const organizationId = owner?.platformSetupProgress?.organizationId;
  if (!owner || !organizationId) {
    throw new Error("The named owner does not have an authenticated current organization.");
  }
  const software = process.argv.includes("--software");
  const storefronts = await prisma.storefrontConfig.findMany({
    where: {
      organizationId,
      archetype: { archetypeId: software ? "software-platform" : "restaurant" },
    },
    select: { id: true },
    take: 2,
  });
  if (storefronts.length === 0) {
    throw new Error("The owner's current organization has no restaurant storefront.");
  }
  if (storefronts.length > 1) {
    throw new Error("The owner's current organization has multiple restaurant storefronts; refusing an ambiguous fixture target.");
  }

  if (software) {
    const scenario = option("--scenario") ?? "populated";
    if (!["populated", "zero", "empty"].includes(scenario)) throw new Error("Unknown software fixture scenario.");
    const environment = await loadEnvironmentClassResolution({ readConfig: async key =>
      (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null });
    const destination = new URL(process.env.DATABASE_URL ?? "invalid:");
    const result = await seedSoftwarePerformanceAcceptanceFixture({ database: prisma,
      organizationId, storefrontId: storefronts[0]!.id, ownerUserId: owner.id,
      target: { environmentClass: environment.environmentClass, databaseHost: destination.hostname, databaseName: destination.pathname.slice(1) },
      scenario: scenario as "populated" | "zero" | "empty" });
    // Persist through the real source reader and existing atomic rollup writer.
    const deps = defaultBusinessMetricRollupDeps();
    const aggregation = await aggregateBusinessMetrics({ ...deps, listRestaurantContexts: async () => [],
      software: { ...deps.software!, listContexts: async () => [{ organizationId, storefrontId: storefronts[0]!.id }] } });
    const saved = await prisma.businessMetricRollup.findMany({ where: { organizationId,
      definitionVersion: "software-ledger-v1" }, select: { metricKey: true, value: true, availability: true, computedAt: true }, take: 7 });
    process.stdout.write(`${JSON.stringify({ ...result, aggregation, saved }, null, 2)}\n`);
    return;
  }
  const result = await seedPerformanceAcceptanceFixture({
    database: prisma as unknown as PerformanceAcceptanceFixtureDatabase,
    organizationId,
    storefrontId: storefronts[0]!.id,
    ownerUserId: owner.id,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
