import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "../generated/client/client";
// @ts-expect-error -- importable runtime guard is plain .mjs by design
import { checkIndexIntegrity } from "./index-integrity-core.mjs";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
let db: PrismaClient;

describeDatabase("index integrity guard with Prisma and PostgreSQL", () => {
  beforeAll(async () => {
    const adapter = new PrismaPg({ connectionString: databaseUrl! });
    db = new PrismaClient({ adapter });
    await db.$connect();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("deserializes a successful amcheck result through Prisma", async () => {
    const queryClient = {
      query: async (sql: string, params: unknown[] = []) => ({
        rows: await db.$queryRawUnsafe<unknown[]>(
          sql,
          ...(params as never[]),
        ),
      }),
    };

    const report = await checkIndexIntegrity(queryClient, {
      amcheckMode: "require",
      schema: "public",
      table: "PlatformConfig",
      uniqueOnly: true,
      requiredIndexes: [{ name: "PlatformConfig_pkey", unique: true }],
    });

    expect(report.failed).toBe(false);
    expect(report.corrupted).toEqual([]);
  });
});
