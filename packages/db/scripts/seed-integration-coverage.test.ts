import { prisma, WriteGateRequirement } from "@dpf/db";
import { afterAll, expect, test, vi } from "vitest";
import { seedIntegrationCoverage } from "./seed-integration-coverage";

afterAll(async () => {
  await prisma.$disconnect();
});

test("WriteGateRequirement has 4 values", () => {
  expect(Object.keys(WriteGateRequirement).length).toBe(4);
});

test("IntegrationCoverageProvider table exists", async () => {
  await prisma.$executeRawUnsafe('SELECT 1 FROM "IntegrationCoverageProvider" LIMIT 1');
});

test("IntegrationRoleCoverage table exists", async () => {
  await prisma.$executeRawUnsafe('SELECT 1 FROM "IntegrationRoleCoverage" LIMIT 1');
});

test("seedIntegrationCoverage upserts the expected providers", async () => {
  const upsert = vi.fn().mockResolvedValue(undefined);
  const mockPrisma = {
    integrationCoverageProvider: {
      upsert,
    },
  } as never;
  const orgId = "org_test";

  await seedIntegrationCoverage(mockPrisma, orgId);

  expect(upsert).toHaveBeenCalledTimes(9);
  expect(upsert.mock.calls.map(([args]) => args.create.providerKey)).toEqual([
    "adp",
    "quickbooks",
    "stripe",
    "microsoft365",
    "hubspot",
    "google-marketing",
    "google-business-profile",
    "facebook-lead-ads",
    "mailchimp",
  ]);
});
