import { prisma } from "@dpf/db";

import {
  seedPerformanceAcceptanceFixture,
  type PerformanceAcceptanceFixtureDatabase,
} from "../lib/demo/performance-acceptance-fixture";

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
  const storefronts = await prisma.storefrontConfig.findMany({
    where: {
      organizationId,
      archetype: { archetypeId: "restaurant" },
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
